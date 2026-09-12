# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository structure

This repository holds one project, `puyopuyo/` — a browser Puyo Puyo in
TypeScript — plus the harness that develops it: `.claude/` for hooks and
settings, `docs/worklog/` for the agent contract and decision logs, and
`audit_log/` for redacted transcripts of every agent run.

It previously also held a multi-agent Python pipeline at the root and an F1
telemetry app in `f1map/`. Both were removed from this branch; they remain in
the repository's other branches.

## Puyo Puyo (`puyopuyo/`)

TypeScript + Vite, tested with Vitest; no framework and no runtime dependencies.
Run everything with `puyopuyo/` as the working directory: `npm ci`, then
`npm run dev`, `npm test`, `npm run typecheck`, `npm run build`.

`src/core/` is pure — board, gravity, group detection and chain resolution take
and return plain data, touch no DOM and import nothing from the rendering layer.
That is what makes the rules testable, so keep new rule logic there and let the
rendering layer read from it rather than reimplementing it. Board geometry and
the chain rules are fixed in `docs/worklog/CONTRACT.md`; `board[y][x]` with `y`
downward is the one convention worth repeating here, because transposing it
silently produces a game that almost works.

`tsconfig.json` sets `incremental` with its build info under
`node_modules/.cache/` so a per-edit `typecheck` costs about a second.

## Branch and PR workflow

`puyo-puyo-web` is a long-lived integration branch and **the end of the line**.
Work happens on disposable session branches (`claude/<slug>-<suffix>`) cut from
it, which are merged back via pull request.

- **Open every PR with `base: puyo-puyo-web`.** GitHub resets the base dropdown
  to the repository default on every new PR, so this must be set explicitly each
  time — it is the easiest mistake to make in this layout.
- **Nothing is ever merged into the default branch.** This repository is a
  sandbox for practising multi-agent development, so `puyo-puyo-web` is where
  the work stops. Do not open a PR against the default branch, and do not treat
  one as owed at the end of the project.
- **The repository default branch is `claude/getting-started-1olkod`, not
  `main`.** It is a leftover session branch that ended up as the default. It is
  only relevant as the thing a PR must *not* accidentally target.
- When the base advances, bring it in with `git merge puyo-puyo-web`. Do **not**
  rebase: session branches are already pushed, and rewriting their history
  breaks any checkout that has them.
- Because nothing leaves `puyo-puyo-web`, changes on it — including deleting
  whole projects — carry no consequence for any other branch.

## Cloud session constraints

Sessions run in an ephemeral VM that is reclaimed after a period of inactivity.
Reopening a session restores the conversation history but not the VM — anything
uncommitted, plus background shell commands and running subagents, is gone.

- Commit and push early. Work that exists only on disk is temporary.
- A session waiting for the user to approve a tool call counts as *inactive* and
  can expire during that wait. Keep routine commands in `permissions.allow`
  (below) rather than letting them prompt.
- Durable state lives outside the VM: GitHub, and server-side Routines (the
  `send_later` tool). Anything held only inside the VM does not survive.

## Claude Code harness (`.claude/`)

Config here is the part of the setup that survives a VM reclaim, so behaviour
that must hold across sessions belongs in these files rather than in a prompt.

- `settings.json` — wires the hooks below and allowlists `npm`, `pytest`,
  read-only `git`, and common read commands so they don't trigger permission
  prompts. `npm install` is deliberately absent: pulling an arbitrary package is
  exactly the moment a prompt is worth paying for.
- `hooks/session-start.sh` (SessionStart) — **stale.** It installs a root
  `requirements.txt` that no longer exists, since the Python pipeline it served
  was removed from this branch. It should install `puyopuyo/`'s dependencies
  instead, plus `pytest` for `audit_log/test_export.py`, which is the only
  Python left here.
- `hooks/block-secrets.sh` (PreToolUse on `Edit|Write|NotebookEdit`) — blocks
  edits to `.env`, `*.pem`, `*.key` and the session token file.
- `hooks/typecheck.sh` (PostToolUse on `Edit|Write`) — runs `npm run typecheck`
  in `puyopuyo/` after any edit to a `.ts` file there, and **exits 2 on type
  errors**. Exit 2 is not decoration: stderr from a PostToolUse hook that exits
  0 is discarded, so reporting failure any other way means Claude never sees it.
  The hook exits 0 without running anything for other paths, and also when
  `puyopuyo/node_modules` is missing, so it can never block work before install.

Hook contract, for anything added here: the tool call arrives as JSON on stdin;
exit 0 allows it, **exit 2 blocks it and feeds stderr back to Claude as the
reason**, any other code only surfaces an error without blocking. A broken hook
fails silently, so run a new hook by hand against both a case it should block
and one it should allow before committing it.

Prefer a hook over an instruction in this file when something must happen every
time: this file is advisory and can be missed, whereas hooks are executed by the
harness.

### Committed plugins do load in cloud sessions (verified)

A probe settled this, since the docs answer it twice and incompatibly:
`discover-plugins` says to declare a plugin under `enabledPlugins` in
`.claude/settings.json` when `/plugin` is unavailable, while
`settings-reference` says that as of v2.1.195 a plugin from an external source
does not load until each user installs it — and a GitHub-hosted marketplace is
an external source.

**Result: it loads.** With `extraKnownMarketplaces` registering
`anthropics/claude-plugins-official` and `enabledPlugins` naming a plugin from
it, that plugin's skills appeared in a cloud session on this repo with no
per-user `claude plugin install`. So `.claude/settings.json` is a working
distribution channel here, not just for local CLI sessions.

Two caveats the probe does not cover: plugins load at **session start**, so a
change only takes effect in the next session, and it must be on the branch that
session checks out — a plugin added on a session branch does not reach sessions
cut from `puyo-puyo-web` until it merges. Cloud sessions also don't start plugin
language servers, so LSP plugins (`typescript-lsp` and friends) are pointless
here whatever the settings say.

`pr-review-toolkit` is enabled: this repo's work runs through pull requests
against `puyo-puyo-web`, so review agents are the plugin that earns its slot.
`typescript-lsp` is enabled too, despite the line above: it is dead weight in a
cloud session but gives inline diagnostics on `puyopuyo/` when the repo is
opened locally, and being ignored rather than broken here means one committed
config serves both. In a cloud session `hooks/typecheck.sh` is what actually
catches type errors.

## CI (`.github/workflows/ci.yml`)

One job on Node 22: `npm ci`, `npm run typecheck`, `npm test`, all with
`puyopuyo/` as the working directory.

The `push` trigger names `puyo-puyo-web` explicitly. A workflow that triggers on
the default branch would never run here, because the default branch is a
leftover session branch (see above) that nothing is pushed to.

The `pull_request` trigger is left unfiltered. The original reason — catching a
final PR against the default branch — was wrong, since no such PR is ever
opened. Unfiltered is kept anyway because it is simpler and checks every PR in
the repository, not because that PR exists.
