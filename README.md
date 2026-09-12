# Puyo Puyo (web)

A browser Puyo Puyo built in TypeScript, where the rules are pure functions and
everything that makes them hard to test — the clock, randomness, the canvas —
is pushed to the edge.

```bash
cd puyopuyo
npm ci
npm run dev        # play it
npm test           # 190 tests
npm run typecheck
npm run build
```

## Layout

| Directory | What it holds |
| --- | --- |
| `puyopuyo/src/core/` | Board, gravity, group detection, chain resolution. No DOM, no timers, no randomness. |
| `puyopuyo/src/game/` | Piece, queue and the `step(state, input)` reducer. Time arrives as `tick(ms)`; the queue's `rng` is injected. |
| `puyopuyo/src/score/` | Chain scoring over a `ResolveResult`, returned with its components rather than as a bare number. |
| `puyopuyo/src/input/` | Keyboard handling with DAS/ARR that advances through `advance(ms)`, not a timer. |
| `puyopuyo/src/render/` | Geometry and canvas drawing. Takes state and a context; reads no clock. |
| `puyopuyo/src/main.ts` | **The only file that knows what time it is.** |
| `docs/worklog/` | The contract the agents work to, and the decisions each one made. |
| `audit_log/` | Redacted transcripts of every agent run. |

## Why it is shaped this way

Chains are where the bugs live, so `core` takes and returns plain data and
boards are written in tests as strings:

```
'.....'
'..R..'
'.RRG.'
'RGGG.'   // → 2 chains
```

The same move pays off twice more: the reducer is tested by feeding it explicit
ticks instead of waiting on a clock, and auto-repeat is tested by calling
`advance(ms)` instead of holding a key. Nothing in the suite sleeps, so nothing
in it flakes.

This repository doubles as a sandbox for multi-agent development. `CLAUDE.md`
carries the branch and PR conventions and the harness setup;
`docs/worklog/CONTRACT.md` carries what parallel agents must agree on before
they start, since they run cold and cannot read each other's work in flight.
