# Agent contract — Puyo Puyo web

Fixed before any agent starts, so parallel agents don't collide and neither has
to wait on the other to learn an interface. Nothing here is negotiable by an
agent; if something in it is wrong, say so in your log instead of changing it.

## File ownership (do not write outside your own set)

| Agent | Owns |
|-------|------|
| **core** | everything under `puyopuyo/` |
| **harness** | `.claude/`, `.github/`, root `CLAUDE.md` |

Both write only their own log under `docs/worklog/`. Neither commits; the
orchestrating session reviews and commits.

## Frozen interface

`puyopuyo/package.json` declares exactly these scripts:

```json
"scripts": {
  "dev": "vite",
  "build": "vite build",
  "test": "vitest run",
  "typecheck": "tsc --noEmit"
}
```

- Commands run with `puyopuyo/` as the working directory.
- `tsconfig.json` sets `"incremental": true` and
  `"tsBuildInfoFile": "node_modules/.cache/tsbuildinfo"` so repeated
  `typecheck` runs are fast enough for a per-edit hook.
- Package name: `puyopuyo`. Private. Type: `module`.

## Board model (both agents assume this)

- Playfield is 6 wide × 12 tall, plus 1 hidden row above (row index 0 is the
  hidden spawn row, so 13 rows total).
- Origin is top-left: `board[y][x]`, `y` grows downward. **Never `board[x][y]`.**
- A cell is a colour or empty. Empty is represented so that it can never be
  confused with a colour id — an empty cell is `null`, colours are a string
  union, and no colour is the empty string.
- A group of 4 or more orthogonally connected same-colour cells pops.
  Diagonals do not connect.
- Gravity applies after every pop, and popping is re-checked until the board is
  stable. The number of those iterations is the chain count.

## Log format

Append to your own file. Each entry:

```
## <ISO timestamp> — <what you were deciding>
**Decision**: what you chose
**Why**: the reason, including what you rejected
**Evidence**: the command you ran and what it printed, or the file you read
**Open**: anything you could not settle, for the next agent or session
```

Log decisions and their evidence — not a narration of every edit. An entry
nobody could act on later is noise.

## Resolved by round 1

The core agent hit three places where the rules above were ambiguous or silent.
Settled here so the next round inherits the answer instead of re-deriving it.

- **Settle before the first pop check.** "Gravity applies after every pop" did
  not say what happens to a board that arrives unsettled. `resolve` settles
  first, which makes it total over any board a test can write as a literal. The
  consequence to remember: `result.board` can differ from the input while
  `chainCount` is 0.
- **Simultaneous pops are one chain link.** This followed from "iterations = the
  chain count" but was never stated. Two separate groups popping in the same
  iteration count as one chain, not two.
- **The hidden row is not settled, and the game loop must settle it.** Row 0 is
  fixed as the spawn row, but nothing said whether it pops. Core treats it as an
  ordinary row; real Puyo Puyo excludes it from popping. Whoever builds the game
  loop decides this explicitly and records it here — do not let it be decided by
  accident.

## Next round

Core logic is done and tested; the game loop is not started. The order the core
agent recommends, and the reason it is that order: piece/pair model with an
injected `rng` → a pure `step(state, input)` reducer that takes ticks as inputs
→ game-over and hidden-row rules → scoring as a pure function over
`ResolveResult` → rendering last. Keeping ticks as inputs is what lets the loop
be tested without a clock, the same way `resolve` is tested without a board.

Also open: `npm audit` reports 2 moderate transitive advisories. Left alone —
`audit fix --force` would take a breaking major bump for a dev-only toolchain.

---

# Round 2

## Decided: the hidden row does not pop

Round 1 handed this decision here rather than letting it be made by accident.
**A puyo sitting in the hidden row (row 0) does not pop and does not join a
group.** This is the real game's rule, and getting it wrong produces a game that
passes every test and still feels broken.

It is added to `resolve` as an explicit, general option, not a special case:

```ts
resolve(board, { hiddenRows?: number })   // default 0
```

`hiddenRows` is how many rows at the top are excluded from popping. The default
stays 0 so the existing rule tests keep testing the rule on any board they like;
the game layer passes `HIDDEN_ROWS`. The decision is then visible at the call
site instead of buried in the rule.

## File ownership

| Agent | Owns |
|-------|------|
| **game** | `puyopuyo/src/game/`, `puyopuyo/tests/game/`, and `puyopuyo/src/core/resolve.ts` (for the `hiddenRows` option only) |
| **score** | `puyopuyo/src/score/`, `puyopuyo/tests/score/` |

Nothing else in `src/core/` changes. Rendering and real input are out of scope
again this round — they land once the reducer's shape is settled.

## Frozen interface

- Time is an **input, not a clock**. The reducer is
  `step(state, input) -> state` where an input is a player action *or* a tick
  carrying elapsed milliseconds. Nothing in `src/game/` may read
  `Date.now`, `performance.now`, `setTimeout` or `requestAnimationFrame`; the
  browser loop feeds ticks in from outside. This is what lets the loop be tested
  without a clock, the same way `resolve` is tested without a canvas.
- Randomness is **injected**: the piece queue takes an `rng: () => number`. No
  `Math.random` inside `src/game/`. Tests pass a seeded generator.
- Scoring is a **pure function over `ResolveResult`**, which already carries the
  inputs it needs (`chain`, `cleared`, `colors` per step). It imports from
  `src/core/` and knows nothing about game state.

## Learned in round 2: write the log entry when you decide, not at the end

The game agent was killed by a rate limit after its code and tests were on disk
but before it wrote its log. Everything it built survived; every reason it had
for building it that way did not, and had to be reconstructed from the code by
someone who was not there.

So: **append the log entry at the moment you make the decision.** A log written
last is the first thing an interruption takes, and it is the only part that
cannot be recovered from the artefact — code states what, never why.

---

# Round 3 — making it playable

Rendering and browser input. No game rules are written this round: if you find
yourself deciding what the game does rather than how it looks or how a key maps
to an action, you are in the wrong layer — say so in your log instead.

## File ownership

| Agent | Owns |
|-------|------|
| **render** | `puyopuyo/src/render/`, `puyopuyo/tests/render/`, `puyopuyo/src/main.ts`, `puyopuyo/index.html`, `puyopuyo/src/style.css` |
| **input** | `puyopuyo/src/input/`, `puyopuyo/tests/input/` |

Nothing under `src/core/`, `src/game/` or `src/score/` changes. If you believe
it must, that is a finding for your log, not an edit.

## Where clocks are allowed, and where they are not

This is the boundary the last two rounds were built to protect:

| Layer | May read a clock? |
|-------|-------------------|
| `src/core/`, `src/game/`, `src/score/` | **No** — already true, keep it that way |
| `src/input/` | **No.** Auto-repeat advances via `advance(ms)`, same as the reducer |
| `src/render/` | Drawing only; takes state and a context, reads no clock |
| `src/main.ts` | **Yes.** `requestAnimationFrame` and `performance.now` live here and nowhere else |

`main.ts` is the only file in the project that knows what time it is. It turns
elapsed milliseconds into `tick(ms)` and DOM events into `PlayerAction`s, and
hands both to `step`.

## Frozen interface — `src/input/`

The render agent codes against this before it exists, so it does not change:

```ts
import type { PlayerAction } from '../game/index.js';

export interface InputSource {
  /** Begin listening. */
  attach(target: EventTarget): void;
  detach(): void;
  /** Advance auto-repeat timing. Given the same ms as the game tick. */
  advance(ms: number): void;
  /** Take every action produced since the last call, in order, and clear them. */
  drain(): PlayerAction[];
}

export function createKeyboardInput(options?: KeyboardOptions): InputSource;
```

`drain()` returning a queue rather than firing callbacks is deliberate: the
reducer must see actions in a defined order relative to each tick, and a
callback fired mid-frame cannot promise that.

Default key map — arrows to move, `z`/`x` to rotate, down to soft drop, space to
hard drop. Make it overridable; do not invent a different default.

## Frozen interface — `src/render/`

```ts
export function draw(ctx: CanvasRenderingContext2D, state: GameState, layout: Layout): void;
```

`draw` is a pure function of its arguments: same state in, same pixels out. It
must not mutate `state`, hold state of its own between calls, or read a clock —
animation driven by elapsed time belongs in `main.ts`, passed in.

Geometry (cell size, origin, board rect, next-piece rect) goes in a separate
module with no canvas import, so it can be tested as arithmetic.

## Testing a layer that draws

Vitest runs in Node, with no canvas and no browser.

- **Geometry**: plain functions, tested directly. This is where the real bugs
  are — an off-by-one in a row offset draws the hidden row into the playfield.
- **Drawing**: pass `draw` a fake context object that records the calls made to
  it, and assert on that record. A fake context is enough to catch "drew 13 rows
  instead of 12" and "drew the piece at the wrong cell".
- **Input**: Node 22 has a global `EventTarget`. Construct one, dispatch
  synthetic key events at it, call `advance(ms)`, and assert on `drain()`. No
  jsdom needed.

Do not reach for a browser-rendering test this round. `npm run build` succeeding
plus the tests above is the bar.

## Corrected: `puyo-puyo-web` is the end of the line

An earlier version of CLAUDE.md said this layout owed a final
`puyo-puyo-web` → default-branch pull request. It does not. This repository is a
sandbox for practising multi-agent development; nothing is ever merged into the
default branch, and no PR should ever target it.

Two things followed from the wrong version and are now void:

- The worry that deleting a project on `puyo-puyo-web` would propagate to the
  default branch. It cannot. Changes here reach no other branch.
- The stated reason for leaving CI's `pull_request` trigger unfiltered. The
  trigger stays unfiltered because it is simpler, not because of a PR that
  never happens.

Worth noting as a memory failure: the wrong rule survived several rounds
because it was written down, read back, and acted on as established fact. A
recorded decision is only as good as its source, and this one came from me
inferring a convention rather than from anyone stating it.
