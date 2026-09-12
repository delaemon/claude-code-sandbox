# core — worklog

## 2026-09-12T03:11Z — scaffold shape and dependency set

**Decision**: `puyopuyo/` is Vite 7 + TypeScript 5.9 + Vitest 3, three devDependencies
and nothing else (no UI framework, no test-runner plugins, no lint stack). Scripts
are exactly the four the contract freezes. `tsconfig.json` carries `incremental` +
`tsBuildInfoFile: node_modules/.cache/tsbuildinfo` as required, plus `strict`,
`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noUnusedLocals`,
`noUnusedParameters` and `verbatimModuleSyntax`.

**Why**: the contract fixes the scripts and the incremental settings but says nothing
about strictness. `noUncheckedIndexedAccess` is the one that matters for this codebase:
it makes `board[y][x]` type as `Cell | undefined`, which is precisely the mistake the
contract's board model is trying to prevent. Paying for it with explicit `!` inside the
core algorithms is worth it, because it forces every *caller* through the bounds-checked
accessors. I added a `vitest.config.ts` with `globals: true` and
`include: ['tests/**/*.test.ts']` so `vitest run` picks up `tests/` and nothing in
`node_modules`; `types: ["vitest/globals"]` in tsconfig keeps `tsc --noEmit` happy about it.

**Evidence**:
```
$ npm install
added 52 packages, and audited 53 packages in 11s
```
`npm audit` reports 2 moderate advisories from the transitive tree; nothing pinned by me,
left alone rather than forcing a breaking `audit fix --force`.

**Open**: `npm run dev` / `npm run build` need an entry point, so there is a placeholder
`index.html` + `src/main.ts` that just prints an empty board. It is scaffolding, not the
renderer — whoever builds the UI should replace `src/main.ts` wholesale.
`vite build` succeeds today (`✓ 9 modules transformed`), so the contract's `build` script
is not a lie.

## 2026-09-12T03:12Z — board and cell types

**Decision**:
```ts
type Color = 'red' | 'green' | 'blue' | 'yellow' | 'purple';
type Cell  = Color | null;
type Board = readonly (readonly Cell[])[];   // board[y][x]
```
Boards are immutable: `setCell` returns a new board, `applyGravity`/`resolve` never
touch their argument. Dimensions are read off the board (`boardWidth`/`boardHeight`)
rather than from the `WIDTH`/`HEIGHT` constants, even though those constants exist and
`createBoard()` defaults to the contract's 6×13.

**Why**:
- `Cell = Color | null` is exactly what the contract asks for: `null` is not a string,
  so it can never be mistaken for a colour id, and no colour is `""`.
- Full colour names (`'red'`) rather than the text-format letters (`'R'`) as the union.
  The letters would have made the parser an identity function, which is tempting, but it
  welds the model to the test fixture format — a renderer then ends up writing
  `cell === 'R'` in CSS-adjacent code. The `COLOR_TO_CHAR` / `CHAR_TO_COLOR` maps in
  `text.ts` are the only place the two vocabularies meet.
- Immutable boards because `resolve` returns a `steps[]` array that carries the board
  after each pop. If boards were mutated in place, every entry in that array would alias
  the same final board and the replay data would be worthless to an animating renderer.
- Size derived from the board, not from constants, so a test can write a 4×3 board as a
  string literal instead of restating a 6×13 playfield to assert one pop. The constants
  stay authoritative for `createBoard()` and are asserted in `tests/board.test.ts`.
- `getCell` **throws** on out-of-bounds instead of returning `null`. "Off the board" and
  "empty cell" are different facts, and flood fill is exactly where conflating them
  silently produces wrong groups. Callers that expect a miss use `inBounds` first.

**Evidence**: `src/core/board.ts`; `tests/board.test.ts` covers the 6×13 default, the
`[y][x]` orientation (a 3×2 board where `(2,1)` is in bounds and `(1,2)` is not),
copy-on-write `setCell`, and the out-of-bounds throw.

**Open**: no garbage/nuisance puyo colour. The contract does not mention them and they
change the pop rules (garbage clears adjacent to a pop but never forms its own group).
Adding one later means widening `Cell`, not changing its shape, so nothing here blocks it.

## 2026-09-12T03:12Z — text format first

**Decision**: `parseBoard` / `formatBoard` in `src/core/text.ts` were written before any
game rule. One char per cell, one line per row, top row first, `.` (also ` ` and `_`)
empty, `R G B Y P` colours. Each line is trimmed and blank lines are dropped, so a
template literal can be indented to match surrounding code. Ragged rows and unknown
characters throw `BoardParseError`. `parseBoardBottom(text, w, h)` pads a short fixture
up into a full-size playfield.

**Why**: this is the leverage in the whole task. Every rule below is tested as
`before-string → after-string`, which means a failing test prints two boards you can read
rather than two nested arrays you have to decode. Ragged input throws rather than padding
because a short row in a fixture is a typo, and silently padding it would make a test pass
for the wrong reason.

**Evidence**: `tests/text.test.ts` — parse/format round-trip, indentation tolerance,
ragged and unknown-character rejection, `parseBoardBottom` padding.

**Open**: the format has no way to mark "this cell is falling" or a cursor position. When
the game loop lands, the active pair will need its own representation alongside the board
rather than a character in it.

## 2026-09-12T03:13Z — resolve settles before it pops

**Decision**: `resolve(board)` applies gravity *first*, then loops {find groups of 4+ →
clear → gravity} until nothing pops. `chainCount` is the number of pop iterations. All
groups poppable at the same instant pop in one step and count as one chain link.
`ResolveResult` is `{ board, chainCount, steps, totalCleared }`, and each `ChainStep`
carries `{ chain, groups, cleared, colors, board }`.

**Why**: the contract says "gravity applies after every pop", which leaves the *first*
check ambiguous — a board written as a string literal can have floating cells that a
played board never would. Settling first makes `resolve` total: any board you can write
down resolves the way the equivalent played position would. The visible consequence is
that `result.board` can differ from the input even when `chainCount === 0`; that is
documented on the function and covered by a test.

Simultaneous pops counting as one link is the standard Puyo rule and follows from the
contract's own definition (chain count = number of gravity/pop iterations), but it is
worth stating because "two groups popped" reads like two chains. Test:
`pops two groups in the same step without counting it as a chain`.

Each step carries the board *after* its pops so a renderer can animate the chain without
re-deriving intermediate states — that is why boards are immutable.

**Evidence**: `src/core/resolve.ts`, `tests/resolve.test.ts`. The 3-chain fixture and what
it asserts:
```
B.....     steps: [red] → [green] → [blue]
B.....     cleared: 4, 4, 4 → totalCleared 12
B.....     final board: a single Y at the bottom
G.....
G.....
G.....
R.....
RRR...
GBY...
```
One fixture I wrote was wrong and the test caught it: `R.RR / R... / ....` looks like it
should collapse into four connected reds, but the columns fall to
`R... / R.RR`, leaving groups of 2 and 2. Replaced with `R.RR / RR.. / ....`, which is
3+2 before gravity and one group of 5 after — a real test of "settle, then check".

**Open**: no scoring. Real Puyo scores a chain with chain/colour/group-size bonus tables,
and `ChainStep` deliberately carries the raw inputs to that formula (`cleared`, `colors`,
`groups`) rather than a number, so scoring can be added as a pure function over
`ResolveResult` without touching `resolve` itself.

## 2026-09-12T03:15Z — verification

**Decision**: reporting the suite as passing only after running it.

**Evidence**:
```
$ npm run typecheck

> puyopuyo@0.0.0 typecheck
> tsc --noEmit


$ npm test

> puyopuyo@0.0.0 test
> vitest run


 RUN  v3.2.7 /home/user/claude-code-sandbox/puyopuyo

 ✓ tests/groups.test.ts (8 tests) 5ms
 ✓ tests/board.test.ts (5 tests) 5ms
 ✓ tests/resolve.test.ts (9 tests) 7ms
 ✓ tests/text.test.ts (5 tests) 4ms
 ✓ tests/gravity.test.ts (6 tests) 3ms

 Test Files  5 passed (5)
      Tests  33 passed (33)
   Start at  03:15:50
   Duration  650ms
```
`tsc --noEmit` prints nothing on success — the blank region above it is the real output,
not a truncation.

Purity audit of `src/core/`:
```
$ grep -rnE "document|window|canvas|setTimeout|setInterval|requestAnimationFrame|Math\.random|Date\.now|performance\." src/core/
src/core/index.ts:3: * side-effect free: no DOM, no canvas, no timers, no randomness.
```
The only hit is the comment saying there are none.

**Open**: nothing failing.

## 2026-09-12T03:16Z — what the contract left ambiguous, and what is next

**Contract gaps** (flagged, not changed, per its own instruction):
1. **First-tick gravity.** "Gravity applies after every pop" does not say whether an
   unsettled board is settled before the first pop check. Resolved here as "yes"; see above.
2. **Simultaneous pops.** "The number of those iterations is the chain count" does imply
   two groups popping together are one link, but it is stated as a consequence rather than
   a rule, and it is the first thing a reader gets wrong.
3. **The hidden row's semantics.** The contract fixes row 0 as the hidden spawn row but
   not its rules. In real Puyo a puyo resting in the hidden row does not pop and does not
   participate in groups, and the game ends when a specific column of it is blocked.
   Nothing in `core/` treats row 0 specially today — it is an ordinary row. That is a
   deliberate deferral, not an oversight: it is a game-loop rule, and baking it into
   `findGroups` would make the pure functions depend on which board size they were given.
   Whoever implements the loop must decide this explicitly.
4. **No colour count.** Five colours are defined; standard Puyo uses four per match. That
   is a game-setup parameter, not a core one.

**Next, in order**:
1. Piece model + queue: an active pair (two cells, one pivot) with rotation and kick
   rules, and a spawner taking an injected `rng: () => number` so the queue is
   reproducible in tests. The RNG injection point belongs here — nothing in the current
   core needs randomness, which is why none was added yet.
2. A `GameState` reducer: `step(state, input)` returning the next state, still pure,
   still no timers. Gravity ticks become an input (`{type: 'tick'}`), not a `setInterval`.
3. Game-over and the hidden-row rules from gap 3.
4. Scoring over `ResolveResult`.
5. Only then rendering and a real `src/main.ts`: a canvas or DOM grid that reads
   `GameState` and animates `resolve().steps`, plus keyboard input mapped to reducer
   actions. Keeping the loop out of `core/` is what makes steps 1-4 testable as string
   literals.
