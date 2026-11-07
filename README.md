# GP

A personal AI race engineer for F1 23 (running under CrossOver on macOS). See
[docs/PLAN.md](docs/PLAN.md) for the full plan and phase status.

**Phase 1 (telemetry core) is in.** Parser, race state, recorder, replay, and a live dashboard.
No engineer/voice yet.

## Setup

Node 22+ and pnpm 10.

```sh
pnpm install
pnpm test        # parser struct sizes, race state, recording round-trip
pnpm typecheck
```

In F1 23: *Settings → Telemetry Settings* → UDP Telemetry **On**, Broadcast **Off**,
IP **127.0.0.1**, Port **20777**, Send Rate **60**, Format **2023**, Your Telemetry **Public**.

## Use

```sh
pnpm desktop                                  # live dashboard window (Electron)
pnpm --filter @gp/cli live                    # same thing in the terminal
pnpm record                                   # save raw packets to recordings/<time>.gprec, Ctrl+C to stop
pnpm record --out recordings/monza-race.gprec --note "Monza 50% race"
pnpm inspect recordings/monza-race.gprec      # counts, sessions, your lap times
pnpm replay recordings/monza-race.gprec --speed 4   # play it back over UDP into anything listening
```

The dashboard also has a Record button; those files go to `~/Documents/GP/recordings`.

Replay lets every later phase be built and tested without driving: record a race once,
then replay it into the app at any speed.

## Layout

```
apps/desktop        Electron dashboard (main process owns UDP + state, renderer is plain TS)
packages/shared     formatting helpers, typed event emitter
packages/telemetry  F1 23 packet parser, RaceState store, UDP listener, .gprec recording/replay
tools/cli           record / replay / inspect / live
docs/PLAN.md        plan, Phase 0 findings, decisions
```

## Notes

- The listener binds `0.0.0.0`, not `127.0.0.1`: under CrossOver the game's packets have
  arrived from both loopback and the LAN IP.
- When the game is paused it only sends Event packets. The state reports `paused`, not a
  disconnect.
- `.gprec` stores raw datagrams, so recordings stay valid when the parser changes.
