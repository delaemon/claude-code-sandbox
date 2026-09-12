# Worklog — harness agent

Owns `.claude/`, `.github/`, root `CLAUDE.md`. Writes nothing under `puyopuyo/`.

## 2026-09-12T03:02:00Z — how the PostToolUse typecheck hook decides to skip

**Decision**: `.claude/hooks/typecheck.sh` exits 0 immediately unless the edited
path, normalised against `CLAUDE_PROJECT_DIR`, matches `puyopuyo/*.ts`. It then
exits 0 again if `npm` is missing, if `puyopuyo/` does not exist, or if
`puyopuyo/node_modules/.bin/tsc` is not executable. Only past those does it run
`npm run typecheck` with `puyopuyo/` as cwd.

**Why**: the hook fires on every `Edit`/`Write` in the repo, including edits to
the Python pipeline and to `CLAUDE.md` itself, so the cheap path has to be the
common one. The install guard is what keeps the hook from turning a fresh
container into a wall of failures before anyone has run `npm ci` — a hook that
blocks work it cannot yet check is worse than no hook. I guard on
`node_modules/.bin/tsc` rather than on the `node_modules` directory because a
half-installed tree would otherwise produce an npm error reported as a type
error. Path matching is done against `CLAUDE_PROJECT_DIR` so both the absolute
form the harness actually sends and a project-relative form work.

**Evidence**: `bash -n` clean. Manual runs, hook fed the real JSON envelope on
stdin, `CLAUDE_PROJECT_DIR` pointed at a throwaway fixture built outside the
repo (scratchpad `fixture/puyopuyo/`, package.json with the contract's
`typecheck` script, tsconfig with `strict`, `typescript` installed):

| case | observed exit |
|------|---------------|
| `puyopuyo/README.md` (not `.ts`) | 0 |
| `other/thing.ts` (`.ts`, outside `puyopuyo/`) | 0 |
| `puyopuyo/src/clean.ts`, types clean | 0 |
| `puyopuyo/src/bad.ts`, `const bad: number = "not a number"` | **2** |
| same, project-relative path form | 0 (clean file) |
| `puyopuyo/` present, `node_modules` absent, file has a type error | 0 |
| `CLAUDE_PROJECT_DIR` with no `puyopuyo/` at all | 0 |
| stdin is `not json`, and stdin empty | 0 |

The failing case printed to stderr:

```
typecheck failed for puyopuyo/src/bad.ts (npm run typecheck, cwd puyopuyo/):
src/bad.ts(1,14): error TS2322: Type 'string' is not assignable to type 'number'.
```

Also run once against the real repo once the core agent's `npm install` had
landed (`puyopuyo/node_modules/.bin/tsc` present): exit 0, i.e. `puyopuyo/`
typechecked clean at that moment.

**Open**: the hook matches `*.ts` only, per the task spec. If the UI layer ever
gains `.tsx`, the case pattern needs `puyopuyo/*.tsx` alongside it.

## 2026-09-12T03:06:00Z — exit 2 rather than exit 1 on type errors

**Decision**: type errors exit 2 with tsc's output on stderr.

**Why**: this is the repo's already-documented hook contract (CLAUDE.md, "Hook
contract"). For PostToolUse specifically, stderr from a hook that exits 0 is not
surfaced to Claude at all, and a non-2 non-zero code only raises a generic
error without feeding the message back — so any other code makes the hook
silently useless, which is the exact failure mode the existing CLAUDE.md warns
about. Rejected: writing failures to a file or printing on stdout.

**Evidence**: observed above — the broken fixture exits 2 and tsc's diagnostic
reaches stderr verbatim.

## 2026-09-12T03:10:00Z — CI triggers

**Decision**: `.github/workflows/ci.yml` runs on `push` restricted to
`puyo-puyo-web` and on `pull_request` with **no branch filter**. One job,
`ubuntu-latest`, `actions/setup-node@v4` with `node-version: '22'`, `cache: npm`
and `cache-dependency-path: puyopuyo/package-lock.json`, then `npm ci` →
`npm run typecheck` → `npm test`, all under `defaults.run.working-directory:
puyopuyo`.

**Why**: the repository default branch is a leftover session branch
(`claude/getting-started-1olkod`), so the usual `branches: [main]` or
default-branch assumption would mean CI never runs. Filtering `pull_request` to
base `puyo-puyo-web` looked tempting for symmetry but would silently skip the
final `puyo-puyo-web` → default-branch PR that CLAUDE.md flags as easy to
forget — exactly the PR you least want unchecked. Unfiltered `pull_request`
costs a run on session-branch PRs, which is what we want anyway. Node 22 matches
the container (`node --version` → v22.22.2). `cache-dependency-path` is needed
because the lockfile is not at the repo root.

**Evidence**: `node --version` → `v22.22.2`; `npm --version` → `10.9.7`.
`puyopuyo/package-lock.json` exists and is not gitignored (`git check-ignore`
exit 1), so `npm ci` and the npm cache both have something to key on. YAML
parsed with `yaml.safe_load` — well-formed.

**Open**: `npm test` is `vitest run`; if the core agent adds a browser-mode
Vitest project it will need a headless browser step added here.

## 2026-09-12T03:13:00Z — settings.json additions

**Decision**: added the `PostToolUse` hook entry (matcher `Edit|Write`), six npm
allowlist entries (`npm ci`, `npm install`, `npm test`, `npm run`, `npx vitest`,
`npx tsc`, all `:*`), and `typescript-lsp@claude-plugins-official` under
`enabledPlugins`. Every pre-existing key left byte-identical.

**Why**: CLAUDE.md's own cloud-session note says a session waiting on an
approval prompt counts as inactive and can expire mid-wait, so the commands this
project runs constantly are the ones that must not prompt. `typescript-lsp` is
enabled even though the same file records that cloud sessions do not start
plugin language servers: it is ignored there rather than broken, and it earns
its slot on a local checkout. I updated that CLAUDE.md paragraph rather than
leave the file contradicting the config.

**Evidence**: `json.load` on the result succeeds. `git diff .claude/settings.json`
shows only additions.

**Open**: `Bash(npm install:*)` allows installing arbitrary packages without a
prompt. Accepted because the task asked for it and the container is disposable,
but it is the broadest entry in the list.
