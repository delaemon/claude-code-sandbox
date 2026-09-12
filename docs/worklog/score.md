# score — worklog

## 2026-09-12T03:20Z — where the scoring tables come from

**Decision**: implement the "Classic" (Puyo Puyo Tsu / compile-era) table set:

| table | values |
|-------|--------|
| chain power, by chain number 1..24 | 0, 8, 16, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448, 480, 512, 544, 576, 608, 640, 672 |
| colour bonus, by distinct colours 1..6 | 0, 3, 6, 12, 24, 48 |
| group bonus, by group size 4..11+ | 0, 2, 3, 4, 5, 6, 7, 10 |

with `clearBonus = clamp(chainPower + colourBonus + groupBonus, 1, 999)` and
`stepScore = cleared * 10 * clearBonus`.

**Why**: the task says to look the tables up, not invent them. `puyonexus.com`
(the wiki the search results all point at) is blocked by this session's egress
proxy, as are gamefaqs, the Puyo fandom wiki and web.archive.org, so I read two
independent *implementations* instead and cross-checked them cell by cell:

- **puyonexus/puyosim**, `resources/scripts/simulator.js` — the chain simulator
  Puyo Nexus itself ships, fetched at commit `7f009eb`. It carries Classic and
  Fever variants of all three tables side by side:
  `colorBonus: [[0, 3, 6, 12, 24], [0, 2, 4, 8, 16]]`,
  `groupBonus: [[0, 2, 3, 4, 5, 6, 7, 10], [0, 1, 2, 3, 4, 5, 6, 8]]`,
  `chainPowers: [0, 8, 16, 32, 64, 96, 128, ... 672]`, and the scoring line
  `clearBonus = Math.min(Math.max(clearBonus, 1), 999)` /
  `bonus = ((puyoCleared * 10) * clearBonus)`.
- **TehRealSalt/sugoi**, `wadsrc/lua/kimokawaiii/puyo/Lua_Puyo.lua` at commit
  `c2e4d38` — an unrelated implementation whose tables are annotated per row
  (`groupbonus[7] = 10 // 11+`, `colorbonus[4] = 24 // 5 colors cleared`),
  which is what pins down what each index *means* rather than just its value.

Rejected the Fever variants: they are a different game's tuning (and the Fever
chain-power curve is 4, 12, 24, 33, 50, 101, ...), and nothing in the contract
asks for Fever.

**Where the two sources disagree** — one cell, plus one open end:

1. **6-chain power**: puyosim says **96**, the Lua table says **92**. I picked
   **96**: puyosim is the reference simulator behind the wiki, and 96 fits the
   32-step pattern of its neighbours (64, 96, 128, 160) while 92 breaks it and
   looks like a transcription slip. `tables.test.ts` pins 96, so flipping this
   is a one-line change with a failing test to point at it.
2. **Past the end of the table**: puyosim continues with
   `prevChainPower + chainPowerInc`, where the default increment is **0** (the
   power flattens at 672); the Lua table keeps adding 32 forever. I took
   puyosim's: `chainPower(n)` holds the last entry for n > 24. Unreachable in
   practice — the longest chain a 6x13 board can hold is about 19 — and the 999
   clamp would eat most of the difference anyway.
3. **6 colours = 48** comes only from the Lua source; puyosim's Classic colour
   table stops at 5 entries. This board has 5 colours, so the entry is
   unreachable. Kept it rather than truncating the table silently, and said so
   in the code comment.

**Evidence**:
```
$ curl -sS -L -o puyosim.js https://raw.githubusercontent.com/puyonexus/puyosim/7f009eb.../resources/scripts/simulator.js
$ grep -n -E "colorBonus|groupBonus|chainPowers" puyosim.js
366:	colorBonus: [[0, 3, 6, 12, 24], [0, 2, 4, 8, 16]], // Color bonuses (Classic, Fever)
367:	groupBonus: [[0, 2, 3, 4, 5, 6, 7, 10], [0, 1, 2, 3, 4, 5, 6, 8]], // Group bonuses (Classic, Fever)
370:	chainPowers: [   0,   8,  16,  32,  64,  96, 128, 160, 192, 224, 256, 288, // Default chain power
371:	   320, 352, 384, 416, 448, 480, 512, 544, 576, 608, 640, 672],

$ sed -n 655,662p puyosim.js
	clearBonus = Math.min(Math.max(clearBonus, 1), 999); // Limit the clear bonus to between 1 to 999.
	...
	var bonus = ((puyoCleared * 10) * clearBonus);
```
and, from the Lua source, `chainpower[5] = 92 // 6 Chain` against puyosim's 96.

**Open**: the wiki pages themselves were unreachable from this VM, so the
citation is to two implementations rather than to the wiki text. If a later
session can reach `puyonexus.com/wiki/Scoring`, the one thing worth re-checking
is the 6-chain 96-vs-92 cell.

## 2026-09-12T03:26Z — the shape of the scoring API

**Decision**: `src/score/` exports

```ts
scoreStep(step: ChainStep, options?) -> StepScore
scoreChain(result: ResolveResult, options?) -> ChainScore   // { total, steps, chainCount, totalCleared }
totalScore(result: ResolveResult, options?) -> number
```

where `StepScore` returns every component, not just the number: `chain`,
`cleared`, `colorCount`, `groupSizes`, `chainPower`, `colorBonus`,
`groupBonus`, `rawBonus` (the un-clamped sum), `clearBonus` (the multiplier
actually applied) and `score`. The tables and their accessors
(`chainPower`, `colorBonus`, `groupBonus`, `clampClearBonus`) are exported
separately from `src/score/tables.ts`.

**Why**: a UI that wants to show "4 chain, 2 colours, x35" needs the parts, and
a bug report that says "it scored 700 and I expected 880" is unanswerable
without them. Keeping `rawBonus` *and* `clearBonus` separate is what makes the
`max(1, ...)` floor visible: on a first single-colour 4-pop the raw sum is 0 and
the multiplier is 1, and a test asserts exactly that rather than asserting 40
and hoping.

`ScoreOptions.threshold` exists because `resolve` itself takes a threshold.
puyosim indexes the group table at `size - min(4, puyoToClear)`, so with a
threshold of 3 a group of 3 still scores 0 and a group of 4 scores 2. Without
the option, scoring a threshold-3 resolve would be silently wrong; with it, the
default is `POP_THRESHOLD` and nothing else has to care.

`src/score/` imports from `src/core/` only (`groups.js` for `POP_THRESHOLD`,
`resolve.js` for the types). No DOM, timers, randomness or game state, as the
contract's Round 2 "Frozen interface" requires.

**Evidence**: `grep -rn "^import" src/score/` shows imports from `../core/` and
`./tables.js` and nothing else.

**Open**: nothing exports `src/score/` from a top-level barrel — `src/core/`
has its own `index.ts` and so does `src/score/`, and `src/main.ts` is not mine
to edit. Whoever wires the renderer imports `../score/index.js` directly.

## 2026-09-12T03:31Z — verification

**Decision**: tests build their inputs by running the real `resolve` on boards
written in `core/text.ts`'s string format; no `ResolveResult` is hand-built
anywhere in `tests/score/`.

**Why**: the task asks for it, and the reason is real — a hand-written
`ResolveResult` keeps passing after the core's shape changes underneath it. The
cost is that a couple of expectations depend on gravity settling the literal
first (`resolve` settles before the first pop check, per the contract's Round 1
note), which is exactly the coupling worth having.

Cases covered: a single 4-group pop scoring 40; the `max(1, ...)` floor with
its components asserted; a 2-colour step (240) and a 3-colour step; a 5-group
step (100) and a 12-cell group hitting the 11+ cap (1200); two groups of
different sizes in one step summing their group bonuses (880); a 2-chain where
chain power appears only on the second link and the total is 40 + 320 = 360; a
board that does not pop scoring 0; and `totalScore` agreeing with the
breakdown. Plus the table accessors and the 1..999 clamp directly.

**Evidence**:
```
$ npm run typecheck
> puyopuyo@0.0.0 typecheck
> tsc --noEmit

$ npm test
> puyopuyo@0.0.0 test
> vitest run

 RUN  v3.2.7 /home/user/claude-code-sandbox/puyopuyo

 ✓ tests/score/tables.test.ts (6 tests) 4ms
 ✓ tests/resolve.test.ts (9 tests) 15ms
 ✓ tests/score/score.test.ts (11 tests) 9ms
 ✓ tests/groups.test.ts (8 tests) 6ms
 ✓ tests/board.test.ts (5 tests) 5ms
 ✓ tests/text.test.ts (5 tests) 4ms
 ✓ tests/gravity.test.ts (6 tests) 3ms

 Test Files  7 passed (7)
      Tests  50 passed (50)
```
33 pre-existing tests + 17 new ones. `tsc --noEmit` was clean with the game
agent's in-progress `src/game/` and its edit to `src/core/resolve.ts` already
on disk (`git status` showed ` M puyopuyo/src/core/resolve.ts` and an untracked
`puyopuyo/src/game/`); no `tests/game/` existed at the time of this run, so
nothing of theirs was exercised. Nothing outside `src/score/`, `tests/score/`
and this log was touched.

**Open**: the game agent's `hiddenRows` option lands on `resolve` as a second
argument. Scoring never calls `resolve`, so it is unaffected — but if
`hiddenRows` ever changes what a `ChainStep` contains (it should not; it only
changes which groups are found), `tests/score/` will catch it, because they go
through the real `resolve`.

## 2026-09-12 — re-check attempted, still unreachable

**Decision**: 6-chain power stays at 96. Unchanged, but now for a second reason:
the re-check this entry asked for has been tried and could not be done.

**Evidence**: from a later session on the same container,
`curl` to `puyonexus.com/wiki/Scoring`, `puyonexus.net` and even
`en.wikipedia.org` all returned HTTP 000 — the egress proxy refuses the CONNECT
(it answers 403 for these hosts). No primary source is reachable from here at
all, so the citation remains to the two implementations, not to the wiki.

**Open**: unchanged. This is the one value worth re-checking from an environment
with wider network access. Until then `tables.test.ts` pins 96, so changing it
is a one-line edit with a failing test pointing straight at it.
