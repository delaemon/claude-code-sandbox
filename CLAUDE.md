@AGENTS.md

# Claude Code adapter

Everything above is the engine-neutral contract, read by Codex and Gemini CLI
too. What follows is **only** what is specific to Claude Code. Nothing here
restates the contract, and nothing here belongs in `AGENTS.md`:
`scripts/agent-contract.mjs` fails if a heading appears in both.

Claude Code reads `CLAUDE.md`, not `AGENTS.md`, which is why the first line of
this file is an import. Anthropic's own documentation recommends exactly that
arrangement. If the import is removed, this engine silently runs on a different
contract from the other two — so it is checked, not trusted.

## Hooks (`.claude/hooks/`)

Hooks are the reason the loop closes under Claude Code and has to be arranged
differently elsewhere: they are how *this* engine executes something on every
turn. `githooks/pre-commit` is the portable equivalent for engines without
them. See `docs/ENGINES.md`.

`doctor.sh` asserts what each hook *does*, so what follows is only the reasoning
a check cannot hold:

- `settings.json` allowlists `npm`, `node --test`, the harness's own entry
  points and read-only commands. **`npm install` is deliberately absent**: pulling an
  arbitrary package is exactly the moment a prompt is worth paying for. So are
  `Bash(node:*)` and `Bash(bash:*)` — either is arbitrary code execution.
- `block-secrets.sh` falls back to matching its raw payload when no JSON parser
  is available, **over-blocking rather than failing open**.
- `session-start.sh` and `typecheck.sh` read `harness.config.json` and do
  nothing when no application is configured. `typecheck.sh` also exits 0 when
  `node_modules` is missing, so it can never block work before install.
- `log-usage.sh` **exits 0 on every path**. A Stop hook that blocked could stop
  a session from ever finishing, which is worse than a missing row.
- `gate-stop.sh` (Stop) runs the **fast** gate tier and returns the work order
  through `additionalContext`. It also **exits 0 on every path**, stays silent
  when the working tree and HEAD are unchanged since its last verdict, and
  never says green — the fast tier asks six questions of seventeen, and the line
  names the eleven it did not ask.
- `record-subagent.sh` (SubagentStop) writes to `audit_log/subagents.jsonl`. It
  records the payload's **known fields by value and the rest by name only**: the
  documented schema is incomplete, this repository is public, and an
  unrecognised field could hold conversation text. Its known list is therefore a
  disclosure decision — only fields that cannot carry a message belong in it —
  and `doctor.sh` asserts both halves.

**Hook contract.** The event arrives as JSON on stdin. **Exit 2 blocks**, on the
events that support blocking (`PreToolUse`, `UserPromptSubmit`, `Stop`), and the
reason comes from stderr. Any other non-zero code surfaces an error without
blocking.

**Exit 0 is not silent.** Stderr is discarded, but **stdout is read as JSON**,
and `hookSpecificOutput.additionalContext` reaches the next turn's reasoning —
supported on `Stop`, `SessionStart`, `UserPromptSubmit` and `PostToolUse`, but
not `PreToolUse`, which uses `permissionDecision` instead.

**Reach for exit 0 with `additionalContext` first; exit 2 is for stopping
something, not for being heard.** Believing otherwise cost a tool call every
turn — `docs/LEDGER.md` row 8.

A hook that breaks fails silently, so run a new one by hand against a case it
should block and one it should allow, then give it a `doctor.sh` case.

**A hook that writes for itself must write somewhere git ignores.** `doctor.sh`
asks each one where it writes, via `--where`, and requires the answer to be
ignored. A hand-kept list of those paths went stale within an hour of being
read — ledger row 40.

## Token usage

**What a session or an agent run cost is written alongside the logs, always**,
and **shown in the conversation every turn**. One definition throughout: output
+ cache writes + fresh input, never cache reads, which would report the context
size times the turn count rather than the work.

| where | what | written by |
| --- | --- | --- |
| `audit_log/turns.jsonl` | one line per stop, **append-only**, numbers only | `hooks/log-usage.sh` |
| `audit_log/usage.md` | one rounded row per session | the same hook |
| `audit_log/INDEX.md` | a `tokens` column per subagent run | `export.mjs` |
| `docs/worklog/*.md` | the cost of the run an entry describes | by hand |

**Per-turn detail goes in `turns.jsonl` because it appends.** The churn that
forced rounding came from rewriting a row in place and re-sorting it, so the
file changed on every stop for reasons unrelated to the numbers; an append adds
one line. `usage.md` stays rounded so the durable summary is not fifty rows of
one session. `docs/LEDGER.md` rows 6, 12 and 13 carry that history.

**Hook output is staged outside git until there is other work to commit it
with** — `audit_log/.turns-pending.jsonl` and friends, folded in by
`scripts/fold-logs.mjs` when `gates.sh` runs. A tracked file that changes every
turn has no quiet state: commit it and CI runs and notifies, don't commit it and
the "uncommitted changes" warning arrives instead. Either way the next turn is
provoked. `paths-ignore` does not help — on `pull_request` it is evaluated
against the whole PR diff, not the push.

**The line returns to the conversation on every stop.** A rate breaker targets a
runaway rather than silence targeting it: five stops inside a minute is faster
than a person, so the line goes quiet and `turns.jsonl` keeps recording.

**Subagent totals cover only runs that left a transcript**, and the line says
how many those are. `agent_transcript_path` names where a transcript would go,
not where one is.

**The line says OVER past `context.compactAt`** (default 400,000), because a
bare `ctx` number is not something anyone can act on. It warns and never
compacts, and an unreadable config falls back to warning rather than to silence
— so a quiet line always means someone set the threshold to 0 on purpose.

**Compacting is a cost lever, not a correctness one, and the default says so
rather than implying otherwise.** 400,000 is Uber's published figure, applied
even on million-token models; their reported win is cost per session roughly
halved. This session measured the other claim on itself and did not find it: it
ran to 782,734 context across two compactions, and its self-corrections came at
7.5% of substantive turns below 200k against 6.3% above 600k — no monotonic
relationship. Where errors did trace to context, they were facts asserted from
recall instead of re-checked, which compacting harder makes **worse**, because
a summary drops exactly those. The failures that actually repeated — the same
truncation five times, the same vacuous test three times — recurred minutes
apart inside one context window. `docs/LEDGER.md` and `evals/run.sh` are the
answer to those; a threshold is not.

**Never claim to know how much quota is left.** Nothing records it: rate-limit
state reaches a transcript only on a refusal, never while requests are being
served. A number invented here would be believed right up until the session
stopped working. *Nothing enforces this — it is prose, and prose is missed.*

That a session which could not be measured is never written as one that cost
nothing **is** enforced, by `doctor.sh`.

## Memory, rules and commands

- Project memory can live in `./CLAUDE.md` or `./.claude/CLAUDE.md`. This file
  is the former, and it imports `AGENTS.md` rather than duplicating it.
- `.claude/rules/*.md` with `paths:` frontmatter load only when Claude reads a
  matching file. Prefer them over lengthening this file: adherence falls off
  past ~200 lines, and everything above this heading is already loaded.
- Slash commands live in `.claude/commands/`. `/auto` runs the whole loop,
  `/gates` reports one verdict, `/harden` records a failure through
  `learn.mjs`, `/ship` takes a change to a watched pull request, `/prune`
  removes prose a check already enforces.
- `/init` and `/import` both read `AGENTS.md`. Neither should be used to copy
  it into this file — the import at the top is what keeps one contract.

## Cloud session constraints

Sessions run in an ephemeral VM, reclaimed after a period of inactivity.
Reopening restores the conversation but not the VM: uncommitted work,
background shell commands and running subagents are gone.

- Commit and push early. Work that exists only on disk is temporary.
- A session waiting for the user to approve a tool call counts as *inactive* and
  can expire during that wait. Keep routine commands in `permissions.allow`
  rather than letting them prompt.
- Durable state lives outside the VM: GitHub, and server-side Routines (the
  `send_later` tool).

## Plugins

`settings.json` registers `anthropics/claude-plugins-official` via
`extraKnownMarketplaces` and enables plugins through `enabledPlugins`. **This
works in cloud sessions** — verified here, with no per-user `claude plugin
install`. A committed `settings.json` is a real distribution channel, and one
the other two engines do not have.

Two limits it does not lift: plugins load at **session start**, so a change
reaches only the next session and only on the branch that session checks out;
and cloud sessions never start plugin language servers, which is why
`hooks/typecheck.sh` rather than `typescript-lsp` is what catches type errors
there.
