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
