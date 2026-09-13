# The deterministic control plane for LLM agents

A reference architecture for enterprises putting LLM agents into production. Its
one claim is the one this repository already makes about itself: **a guarantee
belongs in a layer that executes, never in prose an LLM is asked to interpret.**
Everything below is assembled from named public standards; nothing here is
novel, and that is the point — the deterministic layer is a solved problem in
access control, and agents are a new client for it, not a new discipline.

## Why this matters, stated precisely

Anthropic's own documentation draws the line the whole architecture rests on:

> "Claude treats them as context, **not enforced configuration**. To block an
> action regardless of what Claude decides, use a PreToolUse hook instead."
> — Claude Code memory docs

> "Settings rules are **enforced by the client regardless of what Claude decides
> to do**. CLAUDE.md instructions shape Claude's behavior but are not a hard
> enforcement layer." — Claude Code memory docs

So there are two planes, and confusing them is the root error:

| plane | concrete form | guarantee | review method |
| --- | --- | --- | --- |
| **behavioral guidance** | prompts, CLAUDE.md, rules | probabilistic — best effort | empirical (evals), never inspection-for-compliance |
| **technical enforcement** | policy-as-code, hooks, gateways | deterministic — holds regardless of the model | as ordinary code: unit tests, CI |

An enterprise "framework" is just the discipline of pushing every invariant that
must hold into the second plane, and treating the first as a signal only.

## The spine: PDP / PEP (a 40-year-old access-control pattern, not an AI idea)

The core is not AI-specific. **NIST SP 800-207 (Zero Trust Architecture)** and
**XACML / NIST SP 800-162 (ABAC)** define a four-part split that maps onto an
agent unchanged:

- **PDP — Policy Decision Point**: evaluates "may this action happen?" → policy
  as code. Enterprise-standard engines: **Open Policy Agent (OPA/Rego)**, a CNCF
  graduated project, or **Cedar** (Amazon Verified Permissions). Policies are
  versioned in Git (**PAP**, Policy Administration Point) and unit-tested
  (`opa test`).
- **PEP — Policy Enforcement Point**: the choke point that actually blocks. This
  is the plane that "holds regardless of the model." **Claude Code's
  `permissions` (allow/deny/ask) and a `PreToolUse` hook returning exit 2 are a
  reference PEP** — `exit 2` blocks even when a JSON `permissionDecision` says
  allow.
- **PIP — Policy Information Point**: identity, capability, and context fed to
  the decision.

```
        ┌──────────────── Governance: what must hold ────────────────┐
        │  NIST AI RMF 1.0 (GOVERN/MAP/MEASURE/MANAGE) + AI 600-1     │
        │  ISO/IEC 42001 (AIMS)   Google SAIF                         │
        │  Threats: OWASP LLM Top 10 (2025) · MITRE ATLAS            │
        └───────────────────────────┬────────────────────────────────┘
                                     │  defines invariants
                                     ▼
  LLM Agent ── proposes ──►  PEP  ── asks ──►  PDP (policy as code)
 (probabilistic; untrusted)  (enforce)  allow/deny/step-up   OPA·Rego / Cedar
                             │  ◄── deterministic decision ──┘  PAP = Git
                             ▼
                     mediated execution (MCP / API gateway,
                     least-privilege short-lived credentials)
                             │
                             ▼
                     tamper-evident audit log ── EU AI Act Art.12 · SOC 2
```

The agent only *proposes*; it is never trusted to *enforce*. That directly
answers **OWASP LLM06:2025 Excessive Agency**.

## The layers, each mapped to a public standard

| Layer | Guarantees | Public standard / OSS | Analog in this repo / Claude Code |
| --- | --- | --- | --- |
| Governance | Names the invariants to enforce | **NIST AI RMF 1.0**, **NIST AI 600-1**, **ISO/IEC 42001**, **ISO/IEC 23894**, **Google SAIF** | `AGENTS.md` stating what must hold |
| Threat model | Enumerates the attack surface | **OWASP Top 10 for LLM Apps 2025**, **MITRE ATLAS** | `docs/LEDGER.md` (the failure ledger) |
| Authorization (decide) | Who / what / in which context | **NIST SP 800-207**, **XACML / NIST SP 800-162**, **OPA**, **Cedar** | `permissions.deny/allow/ask` |
| Enforcement (act) | Holds regardless of the model | Claude Code **hooks** (`exit 2`), **managed-settings.json** | `.claude/hooks/`, `gate-stop.sh` |
| Least privilege | Contains the blast radius | **SPIFFE/SPIRE**, short-lived tokens (OAuth / workload identity) | the session's egress allow-list proxy |
| Supply chain | Provenance of models & artifacts | **SLSA v1.0**, **Sigstore/cosign**, **in-toto**, admission control (**OPA Gatekeeper**, **Kyverno**) | **`security/` model scanner = an admission check** |
| Audit | Non-repudiation, compliance | **EU AI Act** Art.12 (records) / 14 (human oversight) / 15 (robustness) | `audit_log/`, `gate-results.jsonl` |
| Assurance | Proves the deterministic layer works | `opa test`, CI gating, ATLAS-derived red-team replay | **`evals/` + verify-by-breaking + `gates.sh`** |

## Request lifecycle — where determinism enters every consequential edge

1. The agent **proposes** a tool call (probabilistic; not trusted).
2. The **PEP** intercepts and turns it into an authorization request.
3. The **PDP** evaluates policy against identity, capability, resource, context
   → `allow` / `deny` / `step-up` (human approval).
4. Only on allow does a **mediated gateway** execute it, with least-privilege,
   short-lived credentials; egress is held to an allow-list.
5. The decision and its rationale go to a **tamper-evident audit log** (EU AI
   Act / SOC 2 / ISO 42001).
6. Policies and scanners are **unit-tested and red-team-replayed in CI**, and
   verified by breaking — the guard is proven to fail when it should.

## The honest boundary

- Input filters (prompt-injection detection) and LLM-as-judge are
  **probabilistic**. Keep them as defense-in-depth *signals*; never let a
  guarantee rest on them. The guarantee always lives in a deterministic PEP.
- Deterministic means "the policy is enforced as written," **not** "the policy
  is correct." So the PDP itself is tested (`opa test`) and gated in CI — the
  same reason this repo tests its own hooks in `doctor.sh`.
- This is defense in depth, not a proof of safety. No single layer is the
  control; the composition is.

## References

- NIST AI RMF 1.0 (NIST AI 100-1), 2023; Generative AI Profile (NIST AI 600-1), 2024.
- NIST SP 800-207, Zero Trust Architecture, 2020 (PDP/PEP).
- NIST SP 800-162, Guide to Attribute Based Access Control (ABAC), 2014; OASIS XACML 3.0.
- ISO/IEC 42001:2023 (AI management system); ISO/IEC 23894:2023 (AI risk management).
- OWASP Top 10 for LLM Applications, 2025.
- MITRE ATLAS (Adversarial Threat Landscape for Artificial-Intelligence Systems).
- Google Secure AI Framework (SAIF), 2023.
- Open Policy Agent (OPA/Rego), CNCF; Cedar / Amazon Verified Permissions.
- SLSA v1.0 (OpenSSF); Sigstore/cosign; in-toto attestations.
- SPIFFE/SPIRE (CNCF); OPA Gatekeeper; Kyverno.
- EU AI Act, Regulation (EU) 2024/1689 (Arts. 12, 14, 15).
- Anthropic: Model Context Protocol (MCP); Claude Code hooks, permissions, and managed settings; Responsible Scaling Policy.

> Standard identifiers and dates above are stable public references; verify the
> exact article/section numbers against the primary source before citing them in
> a formal compliance document.
