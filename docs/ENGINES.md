# Engines

How Claude Code, Codex and Gemini CLI are each wired to the one contract in
`AGENTS.md`, what each of them does differently, and what is deliberately not
shared.

## The shape

```
                      ┌──────────────────────────────┐
                      │        AGENTS.md             │
                      │  the contract — one file,    │
                      │  no engine owns it           │
                      └──────────────┬───────────────┘
                                     │
        ┌────────────────────────────┼────────────────────────────┐
        │                            │                            │
   @AGENTS.md                   (by filename)            context.fileName
        │                            │                            │
┌───────┴────────┐          ┌────────┴───────┐          ┌─────────┴────────┐
│  CLAUDE.md     │          │    Codex       │          │ .gemini/         │
│  + .claude/    │          │  + .codex/     │          │   settings.json  │
│  hooks,        │          │  (nothing to   │          │ + GEMINI.md      │
│  permissions,  │          │   configure)   │          │                  │
│  plugins       │          │                │          │                  │
└───────┬────────┘          └────────┬───────┘          └─────────┬────────┘
        │                            │                            │
        └────────────────────────────┼────────────────────────────┘
                                     │
                      ┌──────────────┴───────────────┐
                      │   scripts/gates.sh           │
                      │   knows no engine. 16 gates, │
                      │   one verdict, same for all  │
                      └──────────────────────────────┘
```

**Normalise the contract, not the engines.** The contract is the same prose for
everyone, so it is one file. The engines genuinely differ in how they
authenticate, what they may run without asking, and whether they can execute
anything automatically — so those stay separate, per engine, and are *not*
generated from a shared source.

There is no build step. Nothing compiles `AGENTS.md` into three files. Each
engine is *pointed at* the original by its own native mechanism, which means
what an agent reads is a file a human can also read, with no generated
intermediate to get stale.

## Wiring, per engine

| | Claude Code | Codex | Gemini CLI |
| --- | --- | --- | --- |
| Reads the contract via | `CLAUDE.md` with `@AGENTS.md` | `AGENTS.md` natively | `.gemini/settings.json` → `context.fileName` |
| Engine-specific file | `CLAUDE.md` (below the import) | `.codex/README.md` | `GEMINI.md` |
| Setup needed | none — committed | none | none — committed |
| Automatic gating | Stop hook, every turn | `githooks/pre-commit` | `githooks/pre-commit` |
| Committed permissions | `.claude/settings.json` | — | — |
| Checked by | `scripts/agent-contract.mjs` | same | same |

### Claude Code

`CLAUDE.md` begins with a single line:

```markdown
@AGENTS.md
```

Everything after it is Claude-specific and adds to the contract rather than
restating it. Anthropic's documentation recommends exactly this arrangement; a
symlink (`ln -s AGENTS.md CLAUDE.md`) also works when there is nothing
engine-specific to add, but not on Windows without Developer Mode.

This is the only engine here that can run something on every turn.
`.claude/hooks/gate-stop.sh` runs the fast gate tier and hands the next turn a
work order — see `docs/AUTOMATION.md`. It is also the only engine with a
**committed** permission allowlist, which makes "what may this agent run" a
reviewable fact rather than a per-developer habit.

### Codex

Nothing to configure. Codex reads a root `AGENTS.md` natively — the format
originated in Codex tooling and was donated to the Linux Foundation's Agentic
AI Foundation in December 2025, alongside MCP.

The absence of configuration is itself the constraint worth checking: **the
contract file must keep the name `AGENTS.md`.** Rename it and the other two
engines follow the rename through their config, while Codex silently reads
nothing. `scripts/agent-contract.mjs` fails on that.

### Gemini CLI

`.gemini/settings.json`:

```json
{ "context": { "fileName": ["AGENTS.md", "GEMINI.md"] } }
```

`context.fileName` takes an array, so no symlink or import is needed: the
contract loads first, then the engine-specific file. Remove `AGENTS.md` from
that array and this engine runs on a different contract, with nothing in the
diff to suggest it.

## Automatic gating, per engine

The loop in `docs/AUTOMATION.md` — run the gates, read them, record what they
found — is engine-neutral in its middle. Only the *trigger* differs.

| | how the gates run without being asked |
| --- | --- |
| Claude Code | `.claude/hooks/gate-stop.sh` on every stop, ~2s, returns a work order into the next turn |
| Codex, Gemini CLI | `githooks/pre-commit`, at commit time |
| all three | CI, on every push and pull request |

Enable the git hook once per clone:

```bash
git config core.hooksPath githooks
```

It is opt-in rather than installed by a setup script, because a repository that
silently rewrites your git config on clone is worse than one that asks.
`scripts/doctor.sh` reports whether it is enabled, so "I thought that was on"
is visible rather than assumed. `git commit --no-verify` is the escape hatch —
explicit, in your shell history, and it requires no edit to a guard.

**The triggers differ in strength and the table says so rather than implying
parity.** A Stop hook catches a broken tree seconds after it breaks; a
pre-commit hook catches it at commit time; CI catches it after a push. All
three run the same `scripts/gates.sh`, so the *verdict* never depends on which
engine produced the change — only how soon you hear it.

## What is deliberately not shared

Four things stay per engine, and unifying them would be the mistake:

| | why not shared |
| --- | --- |
| **Hooks** | Only Claude Code has lifecycle hooks. There is nothing to normalise — the other two would get an empty abstraction. |
| **Permissions / approval** | A committed allowlist (Claude Code) and an interactive prompt (the others) are different security models, not two dialects of one. |
| **MCP servers** | Configured per engine, with per-engine transport and auth. |
| **Model selection** | Each vendor's own names, flags and defaults. Pinning them centrally would mean maintaining three mappings that all drift. |

These are the `ENGINE ADAPTER SEAM`: the place engine-specific auth, model,
flags and output handling are *contained* rather than spread. Everything below
the seam — `scripts/`, `evals/`, CI — never learns which engine invoked it.

## Why the contract is not compiled per vendor

The obvious-looking alternative is a Terraform-style generator: write one
source, emit `CLAUDE.md`, `GEMINI.md` and `AGENTS.md`. It was considered and
rejected.

Terraform earns its abstraction because the things it targets are genuinely
*different* — an AWS security group and a GCP firewall rule are separate
concepts with separate semantics — and because it tracks state, so it can tell
you when reality has drifted from the declaration.

Neither holds here:

- **There is no semantic gap to bridge.** The build command, the test command,
  the naming conventions and the branch rules are the same words for every
  engine. A generator would be translating a language into itself.
- **There is no state.** These files are prose prepended to a context window.
  Nothing to reconcile, nothing to plan, nothing to destroy.
- **The generated file is what the agent actually reads.** Every "why did it
  ignore this rule" investigation would then run through a build step, and
  every review would carry the diff twice.
- **It adds a failure mode rather than removing one:** an edit to the generated
  file that never reaches the source.

So the contract is a file, and each engine is pointed at it. The thing that is
*checked* is not that three files agree — it is that three engines read **one**
file, which is a property a generator cannot give you and this repository can
assert in about forty lines.

## Adding a fourth engine

1. Add it to `engines.supported` in `harness.config.json`.
2. Teach `scripts/agent-contract.mjs` how that engine reaches a contract, in
   the `ADAPTERS` table. An engine declared but unknown to the check **fails**
   rather than passing quietly — naming it is a claim.
3. Wire it: whatever its native mechanism is, pointing at `AGENTS.md`.
4. Put engine-specific notes in its own file, not in `AGENTS.md`. A heading
   appearing in both the contract and an adapter fails the check.
5. Give it a row in the tables above, and say honestly what it cannot do.
