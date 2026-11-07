# GP — a personal AI race engineer for F1 2020

Status: plan only, nothing built yet. Last updated 2026-11-07.

## 1. What we're building

A macOS desktop app that sits next to F1 2020 (running under CrossOver) and acts as
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
 F1 2020 (Wine/CrossOver)
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
| Hotkey | `uiohook-napi` | Electron `globalShortcut` only fires on press, PTT needs release too |
| STT | `whisper.cpp` (local, Metal) via a small native/CLI wrapper | See §6 |
| TTS | Start with a cloud voice (ElevenLabs/OpenAI), keep macOS `say` as offline fallback | See §6 |

## 4. Telemetry: getting data out of F1 2020

### Game settings

In F1 2020: *Game Options → Settings → Telemetry Settings*

- UDP Telemetry: **On**
- UDP Broadcast Mode: **Off**
- UDP IP Address: **127.0.0.1**
- UDP Port: **20777**
- UDP Send Rate: **20 Hz** to start (10–60 available; 20 is plenty for an engineer)
- UDP Format: **2020**

### Does UDP from CrossOver reach a Mac process?

Probably yes, but **unverified on your machine, so it's the first spike.** Wine
implements Winsock on top of the host's BSD sockets, so a `sendto(127.0.0.1:20777)`
inside the game should be a normal macOS UDP packet that a Node `dgram` socket can
receive. If it doesn't arrive:

1. Try your Mac's LAN IP (e.g. `192.168.x.x`) instead of `127.0.0.1`.
2. Try Broadcast Mode On and bind Node to `0.0.0.0:20777`.
3. Check the macOS firewall isn't blocking incoming UDP for the Node/Electron binary.

Spike test: `nc -ul 20777 | xxd | head` while driving, or a 10-line Node `dgram` script.

### Packet format (2020)

Little-endian, packed structs, 22 cars per array. Every packet starts with a 24-byte header:

| Field | Type |
|---|---|
| packetFormat (2020) | uint16 |
| gameMajorVersion, gameMinorVersion, packetVersion | uint8 ×3 |
| packetId | uint8 |
| sessionUID | uint64 |
| sessionTime | float |
| frameIdentifier | uint32 |
| playerCarIndex, secondaryPlayerCarIndex | uint8 ×2 |

Packet types we care about:

| ID | Packet | Rate | What we use it for |
|---|---|---|---|
| 0 | Motion | send rate | g-forces, yaw, wheel slip/suspension (player only extras) for handling diagnosis and "safe to talk" gate |
| 1 | Session | 2/s | track, session type, laps, weather now, track/air temp, safety car status, **weather forecast samples** |
| 2 | Lap Data | send rate | lap/sector times, position, pit status, lap validity, penalties, distance |
| 3 | Event | on event | session start/end, fastest lap, retirement, DRS, penalty, speed trap, chequered flag |
| 4 | Participants | every 5s | driver names, teams |
| 5 | Car Setups | 2/s | full setup of player car (wings, diff, camber/toe, suspension, ARB, ride height, brakes, tyre pressures, fuel) |
| 6 | Car Telemetry | send rate | speed, throttle, brake, steer, gear, RPM, DRS, brake/tyre temps, tyre pressures |
| 7 | Car Status | send rate | fuel in tank, **fuel remaining laps**, tyre compound, **tyre age**, **tyre wear %**, damage, ERS store/mode |
| 8 | Final Classification | end | results |
| 9 | Lobby Info | lobby | multiplayer only, ignore |

Things the 2020 format **does not** give us, so we compute them:

- **Pit window.** The explicit ideal/latest pit lap fields only arrived in F1 2021. We
  compute our own from tyre wear rate, fuel, pit loss per track, and gaps.
- **Gaps to cars ahead/behind.** Derived from lap distance and timestamps per car.
- **Tyre degradation rate.** Derived from lap times vs. tyre age, fuel-corrected.

Caveats:

- In online sessions other cars' setups come through zeroed. Fine, we only need ours.
- Exact struct layouts must be checked against Codemasters' published 2020 spec before we
  trust offsets. Phase 1 includes a validation step against recorded packets.

## 5. Push-to-talk hotkey

- Use `uiohook-napi` for global keydown/keyup. It needs **Accessibility** and **Input
  Monitoring** permission in macOS settings, plus **Microphone** for capture.
- macOS sees the key before Wine does, so it works while the game has focus. The key is
  *also* delivered to the game, so pick one the game doesn't use (e.g. a function key or
  a spare keypad key).
- Better later: a **wheel/controller button**. Reading the HID device in parallel with the
  game (non-exclusive `node-hid`) usually works on macOS but depends on your wheel. Put it
  in the "nice to have" pile until we know what you drive with.
- Two modes: hold-to-talk (default), and a separate toggle key to open the text overlay.

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

**Uncertainty:** the game and whisper share the CPU/GPU. If you're on Apple Silicon running
F1 2020 through D3DMetal/DXVK, the GPU is already busy. Whisper on short clips should be
fine but we measure it, not assume it.

### Text to speech

| Option | Time to first audio | Sounds like an engineer? | Cost |
|---|---|---|---|
| macOS `say` / AVSpeechSynthesizer | ~instant | No, robotic | Free |
| Local neural (Piper / Kokoro) | ~0.2–0.5s | Decent | Free |
| ElevenLabs / OpenAI TTS (streaming) | ~0.3–0.8s | Yes, best | Paid, small |

Plan: start with `say` to unblock, move to a good voice in Phase 3. We stream by sentence
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
- Model per job: a fast model (Haiku tier) for in-race radio replies, a stronger model
  (Sonnet/Opus tier) for setup work and post-session debriefs.

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
- Watch your usage. A chatty engineer across a 50% race plus a debrief is fine; leaving
  LLM-generated callouts on every lap of every practice session will eat into your
  5-hour window.

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

- **Character:** calm under pressure, direct, dry and occasionally cutting humour, protective
  of the driver but won't sugarcoat a bad stint. Says "copy", "box box", "push now", "we're
  checking". No cheerleading.
- **Radio discipline by context** (we pass the context in each message):
  - *On track, racing:* one or two sentences, numbers first, ~15 words max. No jokes
    unless under safety car or you start it.
  - *Safety car / VSC / cool-down / paused:* longer, banter allowed.
  - *Garage, practice debrief, menus:* full conversation, any topic.
- **Grounding:** never state a number not returned by a tool. If data isn't available,
  say so ("we don't have that, mate"). This is the main guard against made-up gaps.
- **Strategy honesty:** give a recommendation and the reason, flag uncertainty ("weather
  radar says 40% in 8 minutes, I wouldn't bet on it").
- **Memory:** knows your habits from stored notes (you lock fronts into T1 at Monza, you
  prefer a pointy car, etc.).
- **Off-topic:** free conversation is fine; he stays in character but doesn't refuse.

Prompt and tool schemas live in the repo with a small eval set of recorded situations
(replayed telemetry + a question + what a good answer looks like) so persona tweaks don't
silently break usefulness.

## 10. Phases

Each phase ends with something you can use. Rough effort assumes evenings/weekends.

### Phase 0 — Spikes (1–2 evenings) — **de-risk before writing the app**

- [ ] UDP from CrossOver reaches a Node `dgram` listener on the Mac (§4).
- [ ] Agent SDK `query()` works from Node on your Mac using your logged-in subscription;
      measure warm time-to-first-token with a fast model.
- [ ] `uiohook-napi` sees keydown/keyup while F1 2020 has focus; macOS permissions sorted.
- [ ] whisper.cpp transcribes a 3s clip in acceptable time **while the game is running**.

If UDP fails and none of the fallbacks work, the project as described is in trouble;
we'd stop and rethink before going further.

### Phase 1 — Telemetry core (1 week)

- Typed parsers for packets 1, 2, 3, 4, 5, 6, 7 (Motion later).
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
- Own pit window model: when tyres or fuel run out, best lap to stop, undercut/overcut
  threat from the car ahead/behind, safety car "cheap stop" logic.
- Weather: interpret forecast samples, crossover-to-inters reasoning.
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
- Templated lines with variants; optional low-priority LLM flavour only when idle.
- Voice commands: "quiet", "only gaps", "full info".
- **Ship:** he talks you through a race without being asked.

### Phase 6 — Setup engineer (2 weeks, hardest to get genuinely good)

- Garage mode: snapshot setups, diff against previous runs, store per track.
- Handling diagnosis from telemetry: understeer/oversteer by corner phase (steer vs yaw
  rate vs lateral g), wheelspin on exit, lockups, tyre temp spread, brake temps.
- Feedback loop: you say "car's snappy on exit in slow corners", he cross-checks
  telemetry, proposes one or two changes, you test, he compares.
- **Ship:** practice sessions with a useful setup conversation.

Honest note: Claude's built-in knowledge of F1 2020's specific setup model is generic
motorsport knowledge plus forum lore. Good advice here comes from our telemetry analysis
and A/B comparisons, not from the model "knowing" the game. In-race changes are limited
in F1 2020 anyway (brake bias, diff, front wing at a stop), so this is mostly a
practice/quali feature.

### Phase 7 — Memory and personality polish (ongoing)

- Cross-session memory: your tendencies, favourite tracks, running jokes, last race.
- Post-race debrief with a stronger model.
- Persona eval set and tuning.

### Later / maybe

- Wheel button PTT via HID.
- Other games (F1 23/24 have richer telemetry; the parser layer would be per-format).
- Second screen dashboard.

## 11. Risks and unknowns

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| UDP doesn't leave CrossOver | Low–medium | Fatal | Phase 0 spike first; LAN IP/broadcast fallbacks |
| Subscription use of Agent SDK changes again (limits, credit pool, policy) | Medium | High | Backend interface, API-key path ready, keep LLM calls lean |
| Voice round trip too slow to feel like a radio | Medium | Medium | Fast model, short replies, sentence streaming, deterministic callouts |
| CPU/GPU contention with the game under translation | Medium | Medium | Measure in Phase 0; cloud STT/TTS as fallback |
| He makes up numbers | Medium | High (trust) | Tools-only numbers rule, compact tool outputs, eval set |
| He's annoying (too chatty, bad jokes at bad moments) | High at first | Medium | Cooldowns, context-aware radio rules, "quiet" command |
| Setup advice is generic/unhelpful | High | Medium | Ground in telemetry diffs; treat as last, hardest phase |
| PTT key clashes with game input | Low | Low | Pick unbound key; later wheel button |
| Electron packaging with SDK subprocess | Medium | Low | Run unpackaged for personal use |
| 2020 packet offsets wrong | Low | Medium | Validate against spec and recorded data in Phase 1 |

## 12. Open questions for Rohit

1. **Mac:** Apple Silicon or Intel, and how much RAM? Decides whether local whisper/TTS
   is comfortable alongside the game.
2. **Input:** wheel, controller or keyboard? Which spare button/key for push-to-talk?
3. **Paid voice:** OK paying a few dollars a month for a good cloud TTS voice, or local only?
4. **Which subscription plan** (Pro, Max 5x, Max 20x)? Sets how much LLM chatter we can afford.
5. **Modes you actually play:** career, Grand Prix, online, time trial? Race length? This
   decides how much strategy logic matters versus pace coaching.
6. **How chatty by default** during a race: GP-level minimal, or more commentary?
7. **Language/tone:** any lines off limits for the humour? Swearing OK?
8. **Distribution:** strictly personal forever, or might friends use it? If the latter,
   it needs API-key auth from the start (see §7).
9. **Repo layout:** single Electron app, or a small monorepo (`packages/telemetry`,
   `packages/engineer`, `apps/desktop`) so the telemetry parser is reusable?
