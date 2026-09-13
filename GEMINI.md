# Gemini CLI adapter

`AGENTS.md` beside this file is the contract, and it is what you should have
read first. `.gemini/settings.json` sets `context.fileName` to load it ahead of
this file, so everything the other engines are held to applies here unchanged.

Nothing in this file restates the contract. `scripts/agent-contract.mjs` fails
if a heading appears in both.

## How this engine is wired

`context.fileName` takes an **array**, which is why no symlink or import is
needed here: Gemini CLI loads `AGENTS.md` and then this file, in that order.

```json
{ "context": { "fileName": ["AGENTS.md", "GEMINI.md"] } }
```

Remove `AGENTS.md` from that array and this engine runs on a different contract
from Claude Code and Codex, with nothing to show for it in a diff review. That
is the failure `scripts/agent-contract.mjs` exists to catch.

## What is different here

**There is no Stop hook.** The gate loop that runs automatically under Claude
Code has no equivalent in this engine, so the automatic gate is the git hook:

```bash
git config core.hooksPath githooks
```

`githooks/pre-commit` runs `bash scripts/gates.sh --fast` and refuses a commit
the fast tier fails. It is engine-neutral — every engine shells out to git —
and it is the only automatic gating this engine gets locally. CI is the
backstop either way.

**Approval is per-session, not committed.** Claude Code ships a committed
`permissions.allow` list; here the equivalent is whatever you approve when
prompted, which is not shared with the team and not reviewable in a pull
request. Treat anything that must hold for everyone as belonging in a gate, not
in an approval habit.

**Read `docs/ENGINES.md`** before changing how this engine is wired. It is the
one place that describes all three adapters together.
