import dgram from 'node:dgram'
import { TypedEmitter } from '@gp/shared'
import { DEFAULT_PORT } from './constants.ts'
import { type Packet, type ParseResult, parsePacket } from './parse.ts'

export interface ListenerOptions {
  port?: number
  /**
   * Bind address. Defaults to 0.0.0.0: on Rohit's Mac the game's packets arrived from
   * 127.0.0.1 on one run and from the LAN IP on the next, so binding loopback only is fragile.
   */
  host?: string
}

export interface ListenerStats {
  received: number
  parsed: number
  rejected: Partial<Record<Exclude<ParseResult, { ok: true }>['reason'], number>>
}

type ListenerEvents = {
  /** Every datagram, before parsing. The recorder hooks in here. */
  raw: { buf: Buffer; at: number }
  packet: Packet
  error: Error
  listening: { address: string; port: number }
}

/** Receives F1 23 UDP telemetry and emits parsed packets. */
export class TelemetryListener extends TypedEmitter<ListenerEvents> {
  private socket: dgram.Socket | null = null
  readonly stats: ListenerStats = { received: 0, parsed: 0, rejected: {} }

  constructor(private readonly opts: ListenerOptions = {}) {
    super()
  }

  start(): Promise<void> {
    if (this.socket) return Promise.resolve()
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true })
    this.socket = socket
    socket.on('message', (buf) => this.handle(buf))
    socket.on('error', (err) => this.emit('error', err))
    return new Promise((resolve, reject) => {
      socket.once('error', reject)
      socket.bind(this.opts.port ?? DEFAULT_PORT, this.opts.host ?? '0.0.0.0', () => {
        socket.off('error', reject)
        const addr = socket.address()
        this.emit('listening', { address: addr.address, port: addr.port })
        resolve()
      })
    })
  }

  /** Feed a datagram directly (used by replay and tests). */
  handle(buf: Buffer, at = Date.now()): void {
    this.stats.received++
    this.emit('raw', { buf, at })
    const result = parsePacket(buf)
    if (result.ok) {
      this.stats.parsed++
      this.emit('packet', result.packet)
    } else {
      this.stats.rejected[result.reason] = (this.stats.rejected[result.reason] ?? 0) + 1
    }
  }

  stop(): Promise<void> {
    const socket = this.socket
    this.socket = null
    if (!socket) return Promise.resolve()
    return new Promise((resolve) => socket.close(() => resolve()))
  }
}
