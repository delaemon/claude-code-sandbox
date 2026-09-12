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
