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

## 2026-09-12T12:20Z — token usage is logged, and the part that cannot be measured is not

**Tokens**: this entry's work cost ~130,000 (output + cache writes + fresh
input). Session total at the time of writing: 5,000,576 over 1,000 requests.
Recording it here is the convention this entry introduces.

**Decision**: what a session or an agent run costs is written alongside the
logs, carried by a hook rather than by a line in `CLAUDE.md`.

| where | what | written by |
| --- | --- | --- |
| `audit_log/usage.md` | one row per session, updated in place | `hooks/log-usage.sh` (Stop) |
| `audit_log/INDEX.md` | a `tokens` column per subagent run | `export.py` |
| `docs/worklog/*.md` | the cost of the run the entry describes | by hand, like this |

**Why a hook**: the rule has to hold in sessions that have not read this file,
which is `CLAUDE.md`'s own argument for hooks over prose. A `Stop` hook was the
right event — the session's cost is only final when the session stops — but it
is also the most dangerous one available, since exit 2 there refuses to let a
session finish. So it never blocks: it exits 0 on every path and *writes*
rather than nagging.

**The number that is not reported**: how much quota is left. Rate-limit state
appears in a transcript only on a refusal — `status:"rejected"` with `resetsAt`
— and never while requests are being served. Every such record in this
session's transcript is a rejection; there is no "still fine" record to read.
An estimate here would be trusted right up to the moment the session stopped
working, so `scripts/usage.sh` prints `remaining: unmeasurable` instead.

**Cache reads are excluded** from every one of these figures. Each request
re-reads the whole context, so counting them gives context size × turns: 378
million for this session against 4.9 million of actual work. The larger number
is real but answers a different question.

**Two mistakes made while building this, both the same mistake**:

- The first `doctor.sh` check pointed the hook at a *missing* transcript. The
  hook stops at its "file is missing" guard before reaching the `calls === 0`
  guard, so the check passed while that guard was deleted. Fixed by probing
  with a transcript that exists and carries no usage — verified by deleting
  the guard again and watching the check fail.
- The same check's second condition grepped for `doctor-probe`, but the hook
  truncates session ids to 8 characters, so it could never match. A dead
  assertion sitting next to a live one, passing for the wrong reason.

**Open**: `95,865` is what this session's harness reported for the `score`
subagent; `export.py` computes `179,468` for the same run. The breakdown is
output 14,533, cache writes 164,839, fresh input 96, cache reads 3,106,928 —
no combination of which is 95,865. The harness uses an accounting that cannot
be reconstructed from the transcript, so the two numbers are not comparable and
the index does not claim to match it.

## 2026-09-12T12:25Z — the usage log churned every turn; rounding fixed it

**Tokens**: ~25,000 for this correction. Session total ~5,000,000.

**What broke**: the Stop hook added an hour earlier wrote exact counts and a
minute-precision timestamp, so `audit_log/usage.md` changed on every stop. The
environment's own git-check hook then warned about uncommitted changes every
single turn — twice in three turns before it was obvious this would never stop.

**The actual error was in reasoning, not code.** Writing the row every turn was
justified as protecting against a VM reclaim, which it does not: an uncommitted
row dies with the VM exactly like no row at all. Only the committed value was
ever durable, so the per-turn precision bought nothing and cost a permanently
dirty tree.

**Fix**: round. Requests to 100, tokens to 100,000, output to 10,000, timestamp
to the day. A normal turn (+8,000 tokens) now leaves the file untouched;
crossing a threshold (+150,000) updates it. Exact live numbers come from
`scripts/usage.sh --line`, which writes its stamp outside the repository.

**Also corrected**: a claim made earlier in the session that the new hook would
only take effect in the next session. That limit applies to *plugins*. Hooks are
read from `settings.json` and this one fired immediately — which is how the
churn was discovered.

**Third occurrence of the same testing mistake**: the verification grepped for
`churntest` while the hook truncates session ids to 8 characters, so it matched
nothing and the first "no churn" result was measuring an empty file. Re-run
against `churntes`. Two earlier instances of this exact slip are recorded in the
entry above; the pattern is asserting on a value after something has transformed
it.

## 2026-09-12T12:30Z — rounding was right, the granularity was guessed

**Tokens**: ~20,000. Session total ~5,100,000.

The warning came back one turn after the rounding fix. Not a regression of the
mechanism — the row had genuinely crossed a threshold — but proof the
granularity had been picked by eye rather than measured.

**The churn driver was the `output` column**, not the token column. Output
tracks the same work at a tenth of the scale, so rounding it to 10,000 set the
change rate no matter what the 100,000-rounded token column did: output moves a
10,000 boundary every two or three turns.

**Measured instead of guessed.** Observed burn: 3,000-32,000 tokens a turn,
averaging ~10,000. The output column is gone and tokens round to 500,000.
Replaying the *worst* observed rate for sixty consecutive turns changes the file
four times — once per fifteen turns — and the average rate gives about one in
fifty.

**The lesson is about the first fix, not the second.** Rounding was the right
idea and was verified against a +8,000 turn, which passed. The verification used
one sample near the average and none near the top of the range, so it confirmed
the mechanism while saying nothing about the setting. A threshold needs
measuring against the distribution it will actually see.

## 2026-09-12T22:20Z — the undocumented field the recorder was built to find

**Tokens**: ~120,000 for the three-gap work. Session total ~7,000,000.

`SubagentStop` was added to replace a glob over an internal path in
`export.py`. Two things were checked first, and both changed the plan.

**The stated reason was wrong.** The glob was described as failing silently if
the layout moved. It does not: `export.py` prints to stderr and exits 1 on an
empty result, confirmed by pointing it at an empty config directory. The claim
had been made from the shape of the code without running it.

**The documentation could not carry the design.** The published reference does
not give a complete schema for this event, and describes `transcript_path` in a
way suggesting it belongs to the parent rather than the subagent. So the hook
was written to record rather than assume: known fields by value, unknown fields
by name only, because `audit_log` is public and an unrecognised field could hold
conversation text.

**The first real payload settled it.** `transcript_path` is the parent's, as
suspected — and `agent_transcript_path` is present, which is the field that
actually solves the original problem and appears nowhere in the reference.

The glob is still there. One observation is enough to know the field exists and
not enough to depend on it; the next run that produces a second row is what
would justify rewriting `find_transcripts`.
