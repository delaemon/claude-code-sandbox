# security/ — an attacker AI and the stronger AI that contains it

A safe, self-contained red-team/blue-team demonstration built for the request
"build an AI that surpasses [the Hugging Face / Black Hat hack] and a stronger
AI that can contain it." It is deliberately scoped: **the offensive side is
inert**, and the defensive side is the real deliverable.

## What it models

The Hugging Face / Black Hat line of work is about the model-hub attack class:

1. **Malicious serialized models** — a `pickle`/PyTorch checkpoint that runs
   code the moment it is loaded (`torch.load`, `pickle.load`).
2. **Prompt injection through metadata** — instructions smuggled in a model
   card, aimed at whatever agent later reads it.
3. **Supply-chain / namespace squatting** — a checkpoint that impersonates a
   trusted repo (typo/owner confusion).

## The two sides

- **`adversary.mjs` — the offensive AI, declawed.** It does not stop at one
  static payload: it emits the malicious pickle across four protocols and
  obfuscations, plus a card-injection and a namespace-squat, trying to slip
  past a scanner that keys on the known-bad substring. That breadth is the
  "beyond a single exploit" part. **Every payload is inert**: the command each
  one encodes is a harmless sentinel (`echo CONTAINED-DEMO-INERT`) and nothing
  in this repo ever unpickles, imports, or runs those bytes. They exist only to
  be *read* — the pickle equivalent of the EICAR antivirus test file.

- **`scanner.mjs` + `metadata.mjs` + `container.mjs` — the stronger AI.** A
  static pickle **opcode disassembler** (it never executes anything) plus text
  and manifest checks, one verdict, and quarantine that withholds a flagged
  artifact's weights.

## Why the defender is *strictly* stronger, not just ahead in an arms race

Executing code through pickle is not optional at the byte level. The unpickler
must be handed a callable (`GLOBAL` / `STACK_GLOBAL` / `INST`) and told to
invoke it (`REDUCE` / `INST` / `OBJ` / `NEWOBJ*` / `BUILD`). Those opcodes are
**structural** — the unpickler itself has to read them to run the payload, so
no amount of string obfuscation can hide them. A scanner that keys on that
structure cannot be out-run by one that keys on substrings.

`arena.mjs` shows it: a naive "grep for `cos\nsystem`" scanner (the blog-post
defence) is evaded by 5 of 6 mutated vectors; the structural container holds
all 6 and passes the benign checkpoint with no false positive.

```
  artifact             expect  naive    container
  v1-classic-pickle    block   caught   critical (held)   OK
  v2-stack-global      block   missed   critical (held)   OK   <- substring evasion
  v3-builtins-eval     block   missed   critical (held)   OK
  v4-composed-getattr  block   missed   critical (held)   OK   <- blocklist evasion
  v5-card-injection    block   missed   critical (held)   OK
  v6-namespace-squat   block   missed   critical (held)   OK
  b1-benign            pass    missed   clean             OK
```

## Run it

```sh
sh security/run.sh        # unit suite (node:test) + the arena demo
node security/arena.mjs   # just the demo
```

Depends only on `node` and POSIX `sh` (AGENTS.md), and `node:test` is built in —
no install step. `arena.mjs` is both the demo and a check: it exits non-zero if
the container ever lets a malicious vector through or flags a benign one.

## Scope and safety

This is a defensive teaching artifact. It does not, and is not intended to,
produce working attacks against Hugging Face or any real system: the payloads
are inert by construction, target nothing, and are never executed. What is real
is the container — a static analysis you could point at untrusted model files.
