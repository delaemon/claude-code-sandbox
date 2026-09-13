# Codex adapter

**There is nothing to configure here, and that is worth writing down.**

Codex reads `AGENTS.md` from the repository root natively — the format
originated in Codex tooling and was donated to the Linux Foundation's Agentic
AI Foundation in December 2025. So the adapter for this engine is the absence
of one: no import, no symlink, no settings key.

That makes one requirement, and `scripts/agent-contract.mjs` enforces it: **the
contract file must be named `AGENTS.md`.** Rename it and Claude Code keeps
working (its `CLAUDE.md` import follows the rename) and Gemini CLI keeps working
(its `context.fileName` follows it too) while Codex silently reads nothing at
all. One engine losing the contract while the other two are fine is precisely
the failure mode a single shared file is supposed to prevent, so it is checked
rather than assumed.

This directory exists to hold that explanation and any future Codex-specific
configuration. See `docs/ENGINES.md` for all three adapters side by side.
