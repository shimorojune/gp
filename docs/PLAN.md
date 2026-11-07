# GP — a personal AI race engineer for F1 23

Status: plan only, nothing built yet. Last updated 2026-11-07 (v3: target game switched from F1 2020 to F1 23).

**Target setup:** Apple M4, 32 GB RAM. PS5 DualSense controller. Claude Max 5x. All game
modes, races at 50%+. Strictly personal use. pnpm monorepo.

## 1. What we're building

A macOS desktop app that sits next to F1 23 (running under CrossOver) and acts as
a race engineer in the spirit of Gianpiero Lambiase: calm, terse on the radio, blunt,
dry humour, and genuinely useful.

It should:

- Read live telemetry from the game (laps, sectors, tyres, fuel, ERS, damage, weather, gaps).
- Talk to you on push-to-talk: you hold a key, speak, release, and he answers by voice.
- Make proactive calls (pace, gaps, weather, tyre/fuel, pit window, safety car).
- Help with car setup in practice/quali, grounded in your telemetry and your feedback.
- Hold a free conversation about anything when you're not busy driving.
- Run on Claude via the Claude Agent SDK, signed in with your own Claude subscription.

The one design rule everything else follows: **the LLM is too slow to be in the
real-time loop.** Anything time critical is deterministic code. Claude does the
conversation, reasoning, strategy and setup thinking.

## 2. Architecture

```
 F1 23 (Wine/CrossOver)  
        │ UDP 127.0.0.1:20777, ~20–60 Hz
        ▼
┌───────────────────────── Electron main process (Node, TypeScript) ─────────────────────────┐
│                                                                                            │
│  telemetry/        packet parser ──► RaceState store ──► recorder (raw packets to disk)    │
│                                          │   ▲                                             │
│                                          │   └── replay tool (feeds recorded packets)      │
│                                          ▼                                                 │
│  callouts/         rule engine (state diffs) ──► priority queue ──► "safe to talk?" gate   │
│                                                                         │                  │
│  engineer/         Claude Agent SDK session  ◄── in-process MCP tools over RaceState / DB  │
│                    (long-lived, streaming input)                         │                  │
│                                                                          ▼                  │
│  voice/            hotkey (keydown/keyup) ─► mic capture ─► STT ─► engineer ─► TTS ─► audio │
│                                                                                            │
│  store/            SQLite: sessions, laps, stints, setups, driver notes                    │
└────────────────────────────────────────────────────────────────────────────────────────────┘
        │ IPC
        ▼
 Renderer (React): menu-bar popover + small always-on-top overlay (radio log, state, debug)
```

Everything runs locally except the Claude calls (and STT/TTS if we pick cloud providers).

## 3. Stack choice

**Electron + TypeScript + React (renderer) + Node (main).** Recommended.

Reasons, honestly weighed:

- The Agent SDK (`@anthropic-ai/claude-agent-sdk`) is a Node library that spawns the
  Claude Code runtime as a subprocess. We need Node regardless.
- UDP (`node:dgram`), SQLite (`better-sqlite3`), global key hooks (`uiohook-napi`) and
  audio helpers are all mature in Node.
- Tauri would be lighter, but its backend is Rust, so we'd end up running a Node sidecar
  for the SDK anyway. Two runtimes, more IPC, more packaging pain, for no real benefit in a
  personal app. Electron's RAM cost (~200–300 MB) doesn't matter next to a game.

Supporting pieces:

| Concern | Choice | Notes |
|---|---|---|
| Build | `electron-vite` or Electron Forge + Vite | One TS config across main/renderer |
| Telemetry parsing | Own typed parser (fallback: `@racehub-io/f1-telemetry-client`) | Own parser is ~500 lines and fully under our control; evaluate the library in Phase 0 |
| State | Plain TS store in main, pushed to renderer over IPC | No Redux needed |
| Persistence | `better-sqlite3` | Laps, stints, setups, notes |
| Validation | `zod` | Tool schemas for the Agent SDK use zod anyway |
| Push-to-talk | Swift GameController helper (DualSense) + `uiohook-napi` (keyboard backup) | See §5. Electron `globalShortcut` only fires on press, PTT needs release too |
| STT | `whisper.cpp` (local, Metal) with `large-v3-turbo` | M4 + 32 GB handles it. See §6 |
| TTS | ElevenLabs streaming (Flash model), macOS `say` as offline fallback | You're OK paying. See §6 |
| Monorepo | pnpm workspaces + Turborepo | See §3.1 |

### 3.1 Monorepo layout

```
gp/
├── apps/
│   └── desktop/            Electron app: main process wiring, renderer UI (React)
├── packages/
│   ├── shared/             shared types (RaceState, events), zod schemas, logger
│   ├── telemetry/          F1 23 UDP parser,   RaceState store, recorder, derived metrics
│   ├── strategy/           pure functions: deg model, fuel, pit window, undercut, weather
│   ├── callouts/           rule engine, priority queue, safe-to-talk gate, line templates
│   ├── engineer/           Agent SDK session, persona prompt, MCP tools, memory
│   ├── voice/              STT/TTS adapters, audio playback, radio effect
│   └── input/              PTT sources: Swift DualSense helper + keyboard hook
├── tools/
│   ├── replay/             CLI: play recorded sessions into the app at 1x–20x
│   └── evals/              recorded situations + expected engineer behaviour
└── docs/PLAN.md
```

`telemetry`, `strategy` and `callouts` have no Electron dependency, so they're unit-tested
with Vitest against recorded sessions and can be reused if you ever move to a newer F1 game.

## 4. Telemetry: getting data out of F1 23

### Why F1 23 and not F1 2020

- **Much richer telemetry.** F1 23's UDP spec has 14 packet types versus 10, including
  the game's own pit window, full lap/sector/stint history for every car, your available
  tyre sets with expected lap deltas, a dedicated damage packet and extended motion data.
  That removes a lot of the estimating we'd have to do for 2020.
- **Runs under CrossOver.** CodeWeavers rates F1 23 "Runs Well" on macOS (last tested on
  CrossOver 25.0.1). Some third-party reports talk about black screens and instability on
  Apple Silicon, so "it runs" is something you confirm on your M4 first, not something we
  assume.
- **Anti-cheat.** At launch Codemasters said anti-cheat was "on the post-launch roadmap".
  I couldn't find confirmation it was ever added, and you say it isn't there, which fits
  with it running under CrossOver. F1 23 is no longer the current game, so a late anti-cheat
  patch is unlikely. If one ever lands it would break the game under Wine, not just this
  app.

### Game settings

In F1 23: *Settings → Telemetry Settings*

- UDP Telemetry: **On**
- UDP Broadcast Mode: **Off**
- UDP IP Address: **127.0.0.1**
- UDP Port: **20777**
- UDP Send Rate: **20 Hz** to start (10–60 available; 20 is plenty for an engineer)
- UDP Format: **2023**
- Your Telemetry: **Public** (only matters online; "Restricted" hides some of your car
  data from others, and some fields come through zeroed for other cars either way)

### Does UDP from CrossOver reach a Mac process?

Probably yes, but **unverified on your machine, so it's the first spike.** Wine
implements Winsock on top of the host's BSD sockets, so a `sendto(127.0.0.1:20777)`
inside the game should be a normal macOS UDP packet that a Node `dgram` socket can
receive. If it doesn't arrive:

1. Try your Mac's LAN IP (e.g. `192.168.x.x`) instead of `127.0.0.1`.
2. Try Broadcast Mode On and bind Node to `0.0.0.0:20777`.
3. Check the macOS firewall isn't blocking incoming UDP for the Node/Electron binary.

Spike test: `nc -ul 20777 | xxd | head` while driving, or a 10-line Node `dgram` script.

### Packet format (2023)

Little-endian, packed structs, 22 cars per array. Every packet starts with a 29-byte header:

| Field | Type |
|---|---|
| packetFormat (2023) | uint16 |
| gameYear (23) | uint8 |
| gameMajorVersion, gameMinorVersion, packetVersion | uint8 ×3 |
| packetId | uint8 |
| sessionUID | uint64 |
| sessionTime | float |
| frameIdentifier | uint32 |
| overallFrameIdentifier | uint32 |
| playerCarIndex, secondaryPlayerCarIndex | uint8 ×2 |

Packet types:

| ID | Packet | Rate | What we use it for |
|---|---|---|---|
| 0 | Motion | send rate | position, g-forces, yaw for all cars; "safe to talk" gate |
| 1 | Session | 2/s | track, session type, laps, weather, temps, safety car status, **weather forecast with rain %**, **pit window ideal/latest lap**, pit rejoin position, assists |
| 2 | Lap Data | send rate | lap/sector times (ms), gaps, position, pit status, lap validity, penalties, warnings |
| 3 | Event | on event | session start/end, fastest lap, retirement, DRS, penalty, speed trap, safety car, overtakes, chequered flag |
| 4 | Participants | every 5s | driver names, teams, telemetry visibility |
| 5 | Car Setups | 2/s | full setup of your car (wings, diff, camber/toe, suspension, ARB, ride height, brakes, tyre pressures, fuel) |
| 6 | Car Telemetry | send rate | speed, throttle, brake, steer, gear, RPM, DRS, brake/tyre surface/inner temps, tyre pressures |
| 7 | Car Status | send rate | fuel in tank, fuel remaining laps, tyre compound, tyre age, ERS store/mode, flags |
| 8 | Final Classification | end | results, stints |
| 9 | Lobby Info | lobby | multiplayer lobby, mostly ignore |
| 10 | Car Damage | 10/s | **tyre wear % (float)**, tyre damage, brake wear, wing/floor/sidepod/gearbox/engine damage |
| 11 | Session History | cycles cars | **every lap and sector time + tyre stints for every car** |
| 12 | Tyre Sets | cycles cars | **your available tyre sets**, wear, remaining life, **expected lap delta per set** |
| 13 | Motion Ex | send rate | your car only: wheel slip ratio/angle, suspension, local velocity, angular velocity/acceleration |

What this saves us compared to 2020:

- **Pit window** comes from the game. We still run our own model on top (undercut threat,
  safety car stops, tyre set choice) but start from the game's numbers.
- **Rival history** (their lap times and stints) comes from Session History, so "is Leclerc
  on old mediums?" is a lookup, not a guess.
- **Tyre choice** for the next stint can use the game's own per-set lap deltas.
- **Handling diagnosis** (Phase 6) gets real slip angles and ratios from Motion Ex instead
  of inferring them.

Still computed by us: fuel-corrected pace, tyre degradation slope, gaps over time,
safe-to-talk windows.

Caveats:

- Other cars' setups and some status fields come through zeroed online when their
  telemetry is restricted. Fine, we mostly need ours.
- Exact struct layouts must be checked against EA/Codemasters' published F1 23 UDP spec
  (and patch notes, since `packetVersion` can change) before we trust offsets. Phase 1
  includes a validation step against recorded packets. `@racehub-io/f1-telemetry-client`
  already supports the 2023 format and is worth evaluating against our own parser.

## 5. Push-to-talk on the PS5 controller

You drive with a DualSense, so push-to-talk is a controller button, with a keyboard key
as backup.

**Which button.** L3/R3 work, but F1 23 may already bind them (check *Controls*), and
clicking a stick mid-corner is a bad idea. Better candidates, in order:

1. **Mic mute button** (the small one under the PS button). The game almost certainly
   ignores it.
2. **Touchpad click**, if it's unbound in-game.
3. L3 or R3 after unbinding it in the game's controls.

**How we read it while the game has focus.** This is the main technical question here.

- **Primary: a tiny Swift helper using Apple's GameController framework** with
  `GCController.shouldMonitorBackgroundEvents = true` (macOS 11.3+). That lets a background
  app see button presses while another app is focused. The helper prints button down/up
  events as JSON lines on stdout; the Electron main process spawns it and reads them.
  About 60 lines of Swift, built once with `swiftc`.
- **Fallback: `node-hid`** reading the DualSense HID reports directly (non-exclusive). The
  mute button and touchpad click are bits in the input report.
- **Not usable:** Chromium's Gamepad API in the renderer. It only reports input to a focused
  window.

**Unknown until tested:** whether CrossOver/Wine opens the controller *exclusively*, which
would starve our helper. macOS normally allows shared access, but this goes in Phase 0.

**Keyboard backup:** `uiohook-napi` for global keydown/keyup (needs Accessibility and Input
Monitoring permission). Pick a key the game doesn't use. Microphone permission is needed
either way.

Modes: hold-to-talk (default), double-tap to toggle the text overlay, and a long hold to
tell him to shut up for now.

## 6. Speech in and out

Claude doesn't do audio, so we bolt on STT and TTS.

### Speech to text

| Option | Latency | Quality | Cost | Verdict |
|---|---|---|---|---|
| `whisper.cpp` local (small.en / base.en, Metal) | ~0.3–0.8s for a 3s clip on Apple Silicon | Good, struggles a bit with F1 jargon | Free | **Default** |
| macOS Speech framework (via small Swift helper) | Fast, streaming | OK | Free | Fallback |
| Deepgram / similar streaming cloud STT | ~0.2–0.4s | Very good | Paid | If local isn't good enough |

We feed whisper an initial prompt with track names, driver names and terms ("undercut",
"box", "diff", "brake bias") to cut misrecognition.

On your M4 with 32 GB, `large-v3-turbo` should transcribe a 3s clip in roughly 0.3–0.6s.
**Uncertainty:** the game is already using the GPU through CrossOver's translation layer,
so we measure whisper with the game running in Phase 0 rather than assume. If it fights the
game, drop to `small.en` or move to Deepgram streaming.

### Text to speech

| Option | Time to first audio | Sounds like an engineer? | Cost |
|---|---|---|---|
| macOS `say` / AVSpeechSynthesizer | ~instant | No, robotic | Free |
| Local neural (Piper / Kokoro) | ~0.2–0.5s | Decent | Free |
| ElevenLabs / OpenAI TTS (streaming) | ~0.3–0.8s | Yes, best | Paid, small |

Plan: ElevenLabs streaming (Flash model, lowest latency) from Phase 3, with `say` as the
offline fallback. Expect a few dollars to low tens of dollars a month depending on how much
he talks, which with "more commentary" will be a lot. We'll cache audio for repeated
template lines to cut both cost and latency. We stream by sentence
so he starts talking before Claude has finished the reply. A short radio "click" and a
light band-pass filter sells the radio feel cheaply.

A note on voice: don't clone the real GP's voice. Pick a calm, British-Italian-ish voice
from the stock library. It's for you only, but voice-cloning a real person is a line worth
not crossing, and it isn't needed for the vibe.

## 7. Claude Agent SDK and your subscription

### How it's wired

- `@anthropic-ai/claude-agent-sdk` `query()` in **streaming input mode**: one long-lived
  session per race weekend, fed by an async generator of your messages and system events.
  This avoids paying subprocess startup on every question.
- Our own tools exposed via `createSdkMcpServer` + `tool()` (in-process, zod schemas):
  `get_race_snapshot`, `get_lap_history`, `get_tyres_and_fuel`, `get_weather_forecast`,
  `get_gaps`, `get_setup`, `compare_setups`, `get_track_info`, `remember_note`,
  `set_callout_prefs`.
- Lock it down: allow only our MCP tools, no Bash/file editing/web, and don't load your
  user/project Claude Code settings (`settingSources: []`). He's an engineer, not a coding agent.
- Model per job: you're on Max 5x and said use as much as needed, so quality wins where
  latency allows. Sonnet tier by default for radio conversation (good balance of speed and
  wit), Opus tier for setup work, strategy deep-dives under safety car and post-race
  debriefs. Haiku tier only for the low-priority "colour commentary" lines in §9, where
  speed matters more than depth. We'll compare latency in Phase 0 and adjust.

### Auth: what's allowed, plainly

Checked against Anthropic's current docs
([Legal and compliance](https://code.claude.com/docs/en/legal-and-compliance)):

- Using your **own** Claude subscription, signed in through Anthropic's **own** login flow
  (`claude` CLI login, or `claude setup-token`), for personal local use is the ordinary,
  individual use the Pro/Max limits assume. Anthropic staff have said publicly they want to
  encourage local experimentation with the Agent SDK.
- What is **not** allowed: building your own Claude.ai login into the app, collecting or
  storing session tokens yourself, or letting anyone else use your subscription through the
  app. If this ever becomes something you share or ship, it has to move to an API key.
- So: the app never handles credentials. It relies on the Claude Code runtime already being
  logged in on your Mac.

**This policy has moved a lot in 2026.** In February Anthropic tightened subscription
OAuth use outside its own apps; in May it announced a separate monthly Agent SDK credit pool
for subscriptions, then paused it on June 15 ("nothing changes for now"). Expect it to
change again. Practical consequences:

- Build the engineer behind a small `EngineerBackend` interface so switching to an API key
  is a config change, not a rewrite.
- Watch your usage. Max 5x is generous, but "more commentary" across long races in every
  mode plus Opus debriefs is real volume. The overlay will show tokens per session so we
  can see if you get near the 5-hour limit, and fall back to a cheaper model if so.

### Packaging gotcha

The SDK spawns the Claude Code runtime with Node. Inside a packaged Electron app that path
resolution can break. For a personal app the simple answer is: run it unpackaged (`npm run
start` from a launch agent or a tiny `.app` wrapper) and point the SDK at your installed
`claude`. We only fight packaging if you want a proper signed `.app`.

## 8. Latency budget

Realistic numbers for a voice question while driving:

| Step | Estimate |
|---|---|
| Key release → audio clip ready | ~50 ms |
| STT (whisper.cpp, 3s clip) | 300–800 ms |
| Claude time to first token (warm session, fast model, small context) | 700–2000 ms |
| First sentence complete | +300–800 ms |
| TTS first audio | 200–800 ms |
| **Total to hearing him** | **~1.5–4.5 s** |

That's fine for "how are the tyres?" and useless for "brake now". Hence:

- **Proactive callouts never wait on Claude.** Rule engine + templated phrases + TTS
  (and pre-generated audio for the common ones) gets them under ~300 ms.
- Tool results are compact JSON, not raw telemetry, to keep context small and fast.
- Radio replies are capped short by the prompt while on track.
- We log every stage's timing from day one so we tune with numbers.

## 9. Persona and prompt design

Lambiase-inspired, not an impersonation. A short, versioned system prompt covering:

- **Character:** calm under pressure, direct, dry and cutting humour, swears freely,
  nothing off limits. Protective of the driver but won't sugarcoat a bad stint. Says "copy",
  "box box", "push now", "we're checking". No cheerleading.
- **Radio discipline by context** (we pass the context in each message):
  - *On track, racing:* you asked for more commentary, so he talks more than the real
    GP would: lap-by-lap pace notes, what rivals are doing, the odd joke on a straight.
    Still numbers first and short per message (~20 words), because long messages land in
    braking zones. Verbosity is a setting (`quiet` / `normal` / `chatty`, default `chatty`)
    you can change by voice mid-race.
  - *Safety car / VSC / cool-down / paused:* longer, banter allowed.
  - *Garage, practice debrief, menus:* full conversation, any topic.
- **Grounding:** never state a number not returned by a tool. If data isn't available,
  say so ("we don't have that, mate"). This is the main guard against made-up gaps.
- **Strategy honesty:** give a recommendation and the reason, flag uncertainty ("weather
  radar says 40% in 8 minutes, I wouldn't bet on it").
- **Memory:** see §9.1. He takes notes on your preferences and habits and gets better at
  working with you over time.
- **Off-topic:** free conversation is fine; he stays in character but doesn't refuse.

### 9.1 Evolving memory

You want him to keep learning your preferences. Design:

- **Notes store (SQLite):** each note has a category (`driving`, `setup`, `radio`,
  `personal`, `track:<id>`), the text, where it came from (you said it / he inferred it
  from telemetry), a confidence, and timestamps.
- **Writing notes:** a `remember_note` tool he calls when you state a preference
  ("stop telling me sector times") or he notices a pattern ("locks the front-left into T1
  at Monza on 4 of 5 laps"). Explicit statements from you win over inferences.
- **Reading notes:** relevant notes (global + current track) go into the session's system
  prompt at the start, so he doesn't need a tool call to remember who you are.
- **Curating:** at the end of each session an Opus pass merges duplicates, updates stale
  notes and drops ones you've contradicted. Without this the notes pile up and contradict
  each other within a few weeks.
- **Visible and editable:** a Notes tab in the app lists everything he "knows" so you can
  delete wrong ones. Also by voice: "forget that".
- Some preferences are also settings the code reads directly (verbosity, which callouts
  are on, units), not just prompt text, so they reliably take effect.

Prompt and tool schemas live in the repo with a small eval set of recorded situations
(replayed telemetry + a question + what a good answer looks like) so persona tweaks don't
silently break usefulness.

## 10. Phases

Each phase ends with something you can use. Rough effort assumes evenings/weekends.

### Phase 0 — Spikes (1–2 evenings) — **de-risk before writing the app**

- [ ] F1 23 runs stably under CrossOver on your M4 for a full race (you've likely done
      this already).
- [ ] UDP from CrossOver reaches a Node `dgram` listener on the Mac (§4).
- [ ] Agent SDK `query()` works from Node on your Mac using your logged-in subscription;
      measure warm time-to-first-token with a fast model.
- [ ] Swift GameController helper sees the DualSense mute/touchpad button down/up while
      F1 23 has focus (i.e. CrossOver doesn't grab the controller exclusively). Keyboard
      fallback via `uiohook-napi` checked too.
- [ ] whisper.cpp `large-v3-turbo` transcribes a 3s clip in acceptable time **while the
      game is running**, with no frame drops in-game.
- [ ] Scaffold the pnpm monorepo (empty packages, lint, typecheck, Vitest) so the spikes
      land in the right place.

If UDP fails and none of the fallbacks work, the project as described is in trouble;
we'd stop and rethink before going further.

**Phase 0 results so far (2026-11-07, on Rohit's M4, macOS 26.6.1, Node 24):**

- UDP from F1 23 under CrossOver reaches Node `dgram` on `0.0.0.0:20777`. Header
  `packetFormat 2023`, `gameYear 23`, game v1.21, `packetVersion 1`. All 12 expected packet
  types in Time Trial arrived, and each size matched the spec. The high-rate packets come at ~20 Hz.
- Bind to `0.0.0.0`, not `127.0.0.1`: the source address flipped between `127.0.0.1` and
  the LAN IP between runs.
- Paused = only Event packets (BUTN), `sessionTime` frozen. Treat that as "paused", not
  "disconnected".
- The game's `hardware_settings_config.xml` lags the in-game setting, so don't read it to detect
  whether telemetry is on.
- Agent SDK on the Max login: no auth issues. Warm time-to-first-text ~1.6–1.7s for both
  Haiku and Sonnet tiers; API time ~0.9s Haiku, ~1.1–1.6s Sonnet. A fresh `query()` per message
  adds 3–5s of CLI process start/stop, so the long-lived streaming session is mandatory.
- Still to do: DualSense PTT with the game focused, whisper speed with the game running.

### Phase 1 — Telemetry core (1 week)

- Typed parsers for packets 1–7 and 10–12 (Motion, Motion Ex and Lobby later).
- Recorder: dump raw packets with timestamps to a file per session.
- Replay CLI: feed a recording back at real or accelerated speed. Every later phase is
  developed against replays, not by driving laps.
- `RaceState` store: current lap, sectors, best/last laps, position, tyres, fuel, weather,
  forecast, per-car positions and gaps.
- Minimal Electron window showing live state.
- **Ship:** a live debug dashboard and your first recorded sessions.

### Phase 2 — Text chat engineer on a hotkey (1 week)

- Toggle key opens an always-on-top overlay with a text box and radio log.
- Agent SDK session with persona prompt and read-only tools over `RaceState` + SQLite.
- Session lifecycle: new SDK session per game session (`sessionUID` changes), summary
  carried over.
- Notes store and `remember_note` tool (§9.1), Notes tab in the UI.
- **Ship:** type "how did that stint compare to the last one?" between sessions or while
  paused and get grounded answers.

### Phase 3 — Voice (1 week)

- Push-to-talk capture, whisper.cpp STT with vocabulary prompt.
- Streaming TTS by sentence, radio effect, interrupt (press PTT again to cut him off).
- Stage timing logged to the overlay.
- **Ship:** talk to him on track.

### Phase 4 — Race state and strategy awareness (1–2 weeks)

- Lap history and stints in SQLite, fuel-corrected pace, tyre deg slope per compound.
- Pit loss table per track (seed values, refined from your own stops).
- Pit window: start from the game's ideal/latest lap, then layer our own logic: undercut/
  overcut threat from cars ahead/behind (using their stint history), safety car "cheap
  stop", which tyre set to fit (from the Tyre Sets packet deltas).
- Weather: interpret forecast samples with rain %, crossover-to-inters reasoning.
- Tools exposing all of this so Claude reasons over our numbers, not his own guesses.
- **Ship:** "what's the plan?" gets a real strategy answer.

### Phase 5 — Proactive callouts (1–2 weeks)

- Rule engine over state diffs: lap complete (+/− vs best), personal best, gap
  closing/opening past thresholds, weather change in forecast, tyre wear/temps,
  fuel delta, damage, safety car, penalties, pit window open/closing, blue flags if
  derivable.
- Priority queue with cooldowns so he isn't chatty.
- "Safe to talk" gate from telemetry: speak on straights (high throttle, low steer, low
  lateral g), hold non-urgent calls through corners.
- Templated lines with variants for urgent/time-critical calls.
- "Colour commentary" layer for `chatty` mode: on long straights or quiet laps, a fast
  model gets a compact state diff and writes one line (rival battles, pace trend, a joke).
  It's generated ahead of time and dropped if stale by the time there's a safe window.
- Voice commands: "quiet", "only gaps", "more chat".
- **Ship:** he talks you through a race without being asked.

### Phase 6 — Setup engineer (2 weeks, hardest to get genuinely good)

- Garage mode: snapshot setups, diff against previous runs, store per track.
- Handling diagnosis from telemetry: understeer/oversteer by corner phase (steer vs yaw
  rate vs lateral g), wheelspin on exit, lockups, tyre temp spread, brake temps.
- Feedback loop: you say "car's snappy on exit in slow corners", he cross-checks
  telemetry, proposes one or two changes, you test, he compares.
- **Ship:** practice sessions with a useful setup conversation.

Honest note: Claude's built-in knowledge of F1 23's specific setup model is generic
motorsport knowledge plus forum lore. Good advice here comes from our telemetry analysis
(Motion Ex slip data helps a lot) and A/B comparisons, not from the model "knowing" the
game. In-race changes are limited (brake bias, diff, ERS, front wing at a stop), so this
is mostly a practice/quali feature.

### Phase 7 — Memory and personality polish (ongoing)

- Tune memory curation (§9.1) once there are a few weeks of notes.
- Running jokes and callbacks to previous races.
- Post-race debrief with a stronger model.
- Persona eval set and tuning.

### Later / maybe

- Other games (F1 24/25). The parser layer is per-format, so it's mostly a new decoder.
- Second screen dashboard.

## 11. Risks and unknowns

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| UDP doesn't leave CrossOver | Low–medium | Fatal | Phase 0 spike first; LAN IP/broadcast fallbacks |
| Subscription use of Agent SDK changes again (limits, credit pool, policy) | Medium | High | Backend interface, API-key path ready, keep LLM calls lean |
| Voice round trip too slow to feel like a radio | Medium | Medium | Fast model, short replies, sentence streaming, deterministic callouts |
| CPU/GPU contention with the game under translation | Low–medium (M4, 32 GB) | Medium | Measure in Phase 0; smaller whisper model or cloud STT as fallback |
| He makes up numbers | Medium | High (trust) | Tools-only numbers rule, compact tool outputs, eval set |
| He's annoying (too chatty, bad jokes at bad moments) | High at first | Medium | Cooldowns, context-aware radio rules, "quiet" command |
| Setup advice is generic/unhelpful | High | Medium | Ground in telemetry diffs; treat as last, hardest phase |
| CrossOver grabs the DualSense exclusively, so PTT can't see it | Low–medium | Medium | Phase 0 spike; node-hid fallback; keyboard key as last resort |
| Memory notes drift or contradict each other | Medium | Medium | End-of-session curation pass, editable Notes tab |
| Chatty mode is annoying or burns usage | Medium | Low | Verbosity setting, token counter in overlay |
| Electron packaging with SDK subprocess | Medium | Low | Run unpackaged; personal use only, no need for a signed app |
| F1 23 packet offsets wrong | Low | Medium | Validate against spec and recorded data in Phase 1 |
| F1 23 unstable under CrossOver on M4 | Low–medium | Fatal | You confirm it runs a full race before anything else |
| An F1 23 update adds anti-cheat | Low | Fatal (game stops running under Wine) | Nothing to do in the app; parser layer is per-format so another game could slot in |

## 12. Decisions (answered 2026-11-07)

| Question | Answer | What it changes |
|---|---|---|
| Game | F1 23 (switched from F1 2020) | 2023 UDP format, richer data, §4 |
| Mac | Apple M4, 32 GB | Local whisper `large-v3-turbo` is the default STT |
| Input | PS5 DualSense, any spare button | PTT via Swift GameController helper (§5) |
| Paid voice | Yes | ElevenLabs streaming TTS |
| Claude plan | Max 5x, use as needed | Sonnet/Opus tiers by default (§7) |
| Modes | All modes, races 50%+ | Strategy (Phase 4) matters as much as pace |
| Chattiness | More commentary, plus evolving memory of preferences | `chatty` default, colour commentary layer, §9.1 memory |
| Tone | Swearing fine, nothing off limits | Persona prompt has no content restrictions on humour |
| Distribution | Strictly personal | Subscription auth is fine; no API-key path needed now (kept as fallback) |
| Repo | Monorepo | pnpm + Turborepo layout in §3.1 |

## 13. Still open

1. Which DualSense button you actually prefer once we see what F1 23 has bound
   (we'll check in Phase 0).
2. A name for him. "GP" is the obvious one; your call.
3. Voice: pick one from the ElevenLabs library together in Phase 3.
