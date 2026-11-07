import {
  type Options,
  type Query,
  type SDKMessage,
  type SDKUserMessage,
  query,
} from '@anthropic-ai/claude-agent-sdk'
import type { HistoryDb } from '@gp/history'
import { TypedEmitter } from '@gp/shared'
import type { RaceSnapshot } from '@gp/telemetry'
import type { LiveBest } from './history.ts'
import type { NotesStore } from './notes.ts'
import { buildSystemPrompt } from './persona.ts'
import { AsyncQueue } from './queue.ts'
import { createRaceTools } from './tools.ts'
import { situation } from './views.ts'

export interface EngineerOptions {
  snapshot: () => RaceSnapshot
  notes: NotesStore
  /** Long-term session history (gp.db). Optional so tests and the CLI can run without it. */
  history?: HistoryDb
  /** This session's best clean lap trace, live (for get_corner_comparison). */
  liveBest?: LiveBest
  driverName?: string
  engineerName?: string
  /** Model for things the driver asks. Default 'sonnet'. */
  model?: string
  /**
   * Model for automatic checks (notify(): lap completed, gap updates...). Default 'haiku', to
   * save subscription usage. Same conversation, the model is switched per turn.
   */
  checkModel?: string
  /** Working dir for the Claude Code process. Use an empty app-data dir, not a repo. */
  cwd?: string
  /** Extra Options passed through to the SDK (tests, debugging). */
  sdk?: Partial<Options>
}

/** 'ask' = the driver said something. 'event' = an automatic check from the car's systems. */
export type TurnKind = 'ask' | 'event'

export interface Reply {
  id: number
  kind: TurnKind
  model: string
  text: string
  /** ms from ask() to the first streamed text */
  firstTextMs: number | null
  totalMs: number
  toolCalls: string[]
  costUsd: number | null
  isError: boolean
}

type EngineerEvents = {
  /** Streamed text as it arrives (for the overlay, and later sentence-by-sentence TTS). */
  delta: { id: number; kind: TurnKind; text: string }
  tool: { id: number; kind: TurnKind; name: string }
  reply: Reply
  error: Error
  /** Turn bookkeeping, for the log: which turn the SDK is answering. */
  turn: { id: number; kind: TurnKind; phase: 'start' | 'result'; detail: string }
}

interface Pending {
  id: number
  kind: TurnKind
  model: string
  startedAt: number
  firstTextAt: number | null
  text: string
  tools: string[]
  /** A tool ran since the last text, so the next text block needs a separating space. */
  awaitingGap: boolean
  resolve: (r: Reply) => void
  reject: (e: Error) => void
}

/** "[live · Brazil Race · lap 5/18 · P7 · SC: None]" */
export function statusTag(s: RaceSnapshot): string {
  const x = situation(s)
  const parts: string[] = [x.status]
  if (x.track) parts.push(`${x.track} ${x.session ?? ''}`.trim())
  if (x.lap) parts.push(`lap ${x.lap}${x.totalLaps ? `/${x.totalLaps}` : ''}`)
  if (x.position) parts.push(`P${x.position}`)
  if (x.safetyCar && x.safetyCar !== 'None') parts.push(`SC: ${x.safetyCar}`)
  return `[${parts.join(' · ')}]`
}

/**
 * One long-lived Claude conversation for the engineer. Uses the Agent SDK's streaming input
 * mode so the Claude Code process stays warm: Phase 0 measured 3-5s of process start/stop
 * per query() otherwise. Auth comes from the local Claude Code login (Rohit's subscription);
 * this code never touches credentials.
 */
export class EngineerSession extends TypedEmitter<EngineerEvents> {
  private input = new AsyncQueue<SDKUserMessage>()
  private q: Query | null = null
  private pending: Pending[] = []
  private nextId = 1
  private loop: Promise<void> | null = null
  /** Turns run one at a time so each can pick its model. */
  private chain: Promise<unknown> = Promise.resolve()
  private currentModel: string | null = null
  /** Background for the next turn (track brief, profile update), sent with it, not on its own. */
  private context: string[] = []

  constructor(private readonly opts: EngineerOptions) {
    super()
  }

  start(): void {
    if (this.q) return
    const { server, toolNames } = createRaceTools({
      snapshot: this.opts.snapshot,
      notes: this.opts.notes,
      ...(this.opts.history ? { history: this.opts.history } : {}),
      ...(this.opts.liveBest ? { liveBest: this.opts.liveBest } : {}),
    })
    const track = this.opts.snapshot().session?.track ?? null
    const options: Options = {
      model: this.chatModel,
      systemPrompt: buildSystemPrompt({
        driverName: this.opts.driverName ?? 'Rohit',
        engineerName: this.opts.engineerName ?? 'GP',
        notes: this.opts.notes.relevant(track),
        profile: this.opts.history?.profile()?.text ?? null,
      }),
      // He's an engineer, not a coding agent: no built-in tools, only race data + notes.
      tools: [],
      mcpServers: { race: server },
      allowedTools: toolNames,
      permissionMode: 'dontAsk',
      // Don't load the user's Claude Code settings, CLAUDE.md files or plugins.
      settingSources: [],
      includePartialMessages: true,
      thinking: { type: 'disabled' },
      persistSession: false,
      ...(this.opts.cwd ? { cwd: this.opts.cwd } : {}),
      env: { ...process.env, CLAUDE_AGENT_SDK_CLIENT_APP: 'gp-race-engineer/0.1' },
      ...this.opts.sdk,
    }
    this.q = query({ prompt: this.input, options })
    this.currentModel = this.chatModel
    this.loop = this.consume(this.q)
  }

  /**
   * Background the engineer should know (a track brief, a profile update) without a turn of
   * its own: it rides along with the next message, so it costs no extra call.
   */
  addContext(text: string): void {
    this.context.push(text)
    if (this.context.length > 4) this.context.shift()
  }

  /** Ask the engineer something. The current race status is prepended automatically. */
  ask(text: string, opts: { model?: string } = {}): Promise<Reply> {
    return this.send(
      `${statusTag(this.opts.snapshot())} ${text}`,
      opts.model ?? this.chatModel,
      'ask',
    )
  }

  /** True while a reply is being generated or queued. */
  get busy(): boolean {
    return this.pending.length > 0
  }

  private get chatModel(): string {
    return this.opts.model ?? 'sonnet'
  }

  /** Tell the engineer about something that happened (lap completed, pit stop...). */
  notify(event: string): Promise<Reply> {
    return this.send(
      `${statusTag(this.opts.snapshot())} [event] ${event}`,
      this.opts.checkModel ?? 'haiku',
      'event',
    )
  }

  private send(content: string, model: string, kind: TurnKind): Promise<Reply> {
    this.start()
    if (this.context.length) {
      content = `${this.context.map((c) => `[context] ${c}`).join('\n')}\n${content}`
      this.context = []
    }
    const id = this.nextId++
    const run = async (): Promise<Reply> => {
      if (model !== this.currentModel) {
        await this.q?.setModel(model)
        this.currentModel = model
      }
      return new Promise<Reply>((resolve, reject) => {
        this.pending.push({
          id,
          kind,
          model,
          startedAt: performance.now(),
          firstTextAt: null,
          text: '',
          tools: [],
          awaitingGap: false,
          resolve,
          reject,
        })
        this.emit('turn', {
          id,
          kind,
          phase: 'start',
          detail: `${model} pending=${this.pending.length}`,
        })
        this.input.push({
          type: 'user',
          message: { role: 'user', content },
          parent_tool_use_id: null,
          origin: { kind: 'human' },
        })
      })
    }
    const reply = this.chain.then(run, run)
    this.chain = reply.catch(() => {})
    return reply
  }

  private async consume(q: Query): Promise<void> {
    try {
      for await (const msg of q) this.handle(msg)
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err))
      this.emit('error', e)
      for (const p of this.pending.splice(0)) p.reject(e)
    }
  }

  private handle(msg: SDKMessage): void {
    const cur = this.pending[0]
    if (!cur) return
    if (msg.type === 'stream_event' && msg.parent_tool_use_id === null) {
      const ev = msg.event
      if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') {
        if (cur.firstTextAt === null) cur.firstTextAt = performance.now()
        // Separate text from successive assistant messages (before/after a tool call).
        if (cur.awaitingGap && cur.text && !cur.text.endsWith(' ')) {
          cur.text += ' '
          this.emit('delta', { id: cur.id, kind: cur.kind, text: ' ' })
        }
        cur.awaitingGap = false
        cur.text += ev.delta.text
        this.emit('delta', { id: cur.id, kind: cur.kind, text: ev.delta.text })
      } else if (ev.type === 'content_block_start' && ev.content_block.type === 'tool_use') {
        cur.tools.push(ev.content_block.name)
        cur.awaitingGap = true
        this.emit('tool', { id: cur.id, kind: cur.kind, name: ev.content_block.name })
      }
      return
    }
    if (msg.type === 'result') {
      this.pending.shift()
      this.emit('turn', {
        id: cur.id,
        kind: cur.kind,
        phase: 'result',
        detail: `${msg.subtype} pending=${this.pending.length} "${cur.text.trim().slice(0, 40)}"`,
      })
      const reply: Reply = {
        id: cur.id,
        kind: cur.kind,
        model: cur.model,
        text: cur.text.trim() || (msg.subtype === 'success' ? msg.result : ''),
        firstTextMs: cur.firstTextAt === null ? null : Math.round(cur.firstTextAt - cur.startedAt),
        totalMs: Math.round(performance.now() - cur.startedAt),
        toolCalls: cur.tools,
        costUsd: msg.total_cost_usd ?? null,
        isError: msg.is_error,
      }
      this.emit('reply', reply)
      cur.resolve(reply)
    }
  }

  /** Stop the current reply (e.g. driver pressed push-to-talk again). */
  async interrupt(): Promise<void> {
    await this.q?.interrupt()
  }

  async close(): Promise<void> {
    this.input.close()
    this.q?.close()
    await this.loop
    this.q = null
  }
}
