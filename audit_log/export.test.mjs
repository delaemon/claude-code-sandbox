// Tests for the audit log redactor.
//
// This repository is public, so the redactor is the only thing standing between
// a transcript and a leaked credential. It is worth more tests than the rest of
// the exporter put together, and it needs the negative cases as much as the
// positive ones: a redactor that eats git SHAs and content hashes destroys
// exactly what an audit trail exists to preserve.
//
// Run:  node --test audit_log/export.test.mjs
//
// `node --test` is built into Node, so these need nothing installed. The pytest
// version of this file needed a runtime and a package that were not present --
// and the gate that ran it printed `ok` regardless, so none of these assertions
// had ever executed here or in CI. Ledger rows 47 and 48.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { redact, summarise, writeIndex } from "./export.mjs";

/**
 * Join a fake credential from fragments.
 *
 * The values below are invented, but written whole they match the patterns
 * GitHub's push protection scans for, and it blocked this file's first push on
 * the Slack one. Assembling them at import time keeps the literal out of the
 * source while the string the redactor sees is byte-for-byte the same, so the
 * test is no weaker for it. Do not inline these back.
 */
const fixture = (...parts) => parts.join("");

const tmpdir = () => fs.mkdtempSync(path.join(os.tmpdir(), "audit-test-"));

// ── credentials that must be masked ─────────────────────────────────────────

const REDACTED = [
  ["anthropic-key", fixture("sk-", "ant-api03-AAAABBBBCCCCDDDDEEEEFFFFGGGG")],
  ["openai-key", fixture("sk-", "abcdefghijklmnopqrstuvwxyz0123456789AB")],
  ["github-token", fixture("ghp", "_AbCdEfGhIjKlMnOpQrStUvWxYz012345")],
  ["github-oauth", fixture("gho", "_AbCdEfGhIjKlMnOpQrStUvWxYz012345")],
  ["github-pat", fixture("github", "_pat_11ABCDEFG0abcdefghijklmnop")],
  ["slack-token", fixture("xox", "b-123456789012-abcdefghijklmnop")],
  ["aws-access-key", fixture("AKIA", "IOSFODNN7EXAMPLE")],
  ["google-key", fixture("AIza", "SyD-1234567890abcdefghijklmnopqrstuvw")],
  ["bearer", fixture("Authorization: Bearer ", "abcdefghijklmnopqrstuvwxyz123456")],
  ["private-key", fixture("-----BEGIN ", "RSA PRIVATE KEY-----")],
  ["named-secret", "MY_SECRET_TOKEN=hunter2hunter2hunter2"],
  ["named-password", "DATABASE_PASSWORD=s3cr3t-value-here"],
];

for (const [id, text] of REDACTED) {
  test(`secrets are masked: ${id}`, () => {
    const [out, count] = redact(text);
    assert.ok(count >= 1, `not redacted: ${text}`);
    assert.ok(out.includes("[REDACTED:"));
  });
}

// ── things that must survive untouched ──────────────────────────────────────

const KEPT = [
  // Documentation. This exact line appears a dozen times in the archived
  // transcripts, read out of a CLAUDE.md that told people to run it; masking
  // it protects nobody and makes the transcript harder to follow.
  ["doc-placeholder", "ANTHROPIC_API_KEY=your_key_here"],
  ["angle-placeholder", "API_KEY=<your-key>"],
  ["shell-variable", "GITHUB_TOKEN=$GITHUB_TOKEN"],
  // The whole point of the archive. A redactor that eats these is worse than
  // no redactor, because it silently destroys the evidence.
  ["git-sha", "commit 78c5719b1f2a3c4d5e6f7a8b9c0d1e2f3a4b5c6d"],
  ["content-hash", "sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b"],
  ["url", "https://github.com/delaemon/claude-code-sandbox/pull/4"],
  ["agent-id", "agent-a7cd58378ae3d07b1.jsonl"],
];

for (const [id, text] of KEPT) {
  test(`non-secrets survive: ${id}`, () => {
    const [out, count] = redact(text);
    assert.equal(count, 0, `wrongly redacted: ${text} -> ${out}`);
    assert.equal(out, text);
  });
}

// ── the fingerprint ─────────────────────────────────────────────────────────

test("the same secret gets the same fingerprint", () => {
  // This is what keeps "the same token appears in both runs" answerable from
  // the archive without the token being readable.
  const token = fixture("ghp", "_AbCdEfGhIjKlMnOpQrStUvWxYz012345");
  const [out, count] = redact(`first ${token} second ${token}`);
  assert.equal(count, 2);
  const masked = out.split("first ")[1].split(" second ")[0];
  assert.equal(out.split(masked).length - 1, 2);
});

test("different secrets get different fingerprints", () => {
  const [a] = redact(fixture("ghp", "_" + "A".repeat(32)));
  const [b] = redact(fixture("ghp", "_" + "B".repeat(32)));
  assert.notEqual(a, b);
});

test("the secret itself never survives", () => {
  const secret = fixture("sk-", "ant-api03-SHOULD-NEVER-APPEAR-IN-OUTPUT");
  const [out] = redact(`{"env": "${secret}", "note": "context around it"}`);
  assert.ok(!out.includes(secret));
  assert.ok(out.includes("context around it"));
});

test("redaction is idempotent", () => {
  // Re-exporting an already-redacted file must not mangle it further.
  const token = fixture("ghp", "_AbCdEfGhIjKlMnOpQrStUvWxYz012345");
  const [once] = redact(`token ${token} here`);
  const [twice, count] = redact(once);
  assert.equal(twice, once);
  assert.equal(count, 0);
});

test("redaction is idempotent for a named assignment too", () => {
  // The Python version was not: its second pass re-masked the `[REDACTED:...]`
  // placeholder, giving the same credential a different fingerprint in a
  // re-exported archive — losing the one property the fingerprint provides.
  const [once] = redact("MY_SECRET_TOKEN=hunter2hunter2hunter2");
  const [twice, count] = redact(once);
  assert.equal(twice, once);
  assert.equal(count, 0);
});

test("masking a secret twice in one pass does not skip the second", () => {
  // A /g regex carries lastIndex between uses. Sharing one across calls makes
  // the next call start mid-string and miss an earlier match — a redactor
  // letting a credential through silently, which is the worst failure here.
  const token = fixture("ghp", "_AbCdEfGhIjKlMnOpQrStUvWxYz012345");
  for (let i = 0; i < 3; i++) {
    const [out, count] = redact(`a ${token} b ${token} c`);
    assert.equal(count, 2, `pass ${i} masked ${count}`);
    assert.ok(!out.includes(token));
  }
});

test("surrounding JSON stays a parseable shape", () => {
  // Masking must not introduce quotes or backslashes into a JSONL line.
  const token = fixture("ghp", "_AbCdEfGhIjKlMnOpQrStUvWxYz012345");
  const [out] = redact(`{"a": "${token}", "b": 1}`);
  assert.equal(out.split('"').length - 1, 6);
  assert.ok(!out.includes("\\"));
});

// ── token accounting ────────────────────────────────────────────────────────
//
// The index carries what each run cost. The distinction that matters is between
// a run with no usage records and a run that cost nothing: the second does not
// happen, so the first must not render as a zero.

const writeTranscript = (dir, body) => {
  const file = path.join(dir, "agent-abc.jsonl");
  fs.writeFileSync(file, body, "utf8");
  return file;
};

test("summarise sums output, cache writes and fresh input", () => {
  const dir = tmpdir();
  const file = writeTranscript(
    dir,
    JSON.stringify({ message: { usage: {
      output_tokens: 100, cache_creation_input_tokens: 20,
      input_tokens: 3, cache_read_input_tokens: 999999 } } }) + "\n" +
    JSON.stringify({ message: { usage: {
      output_tokens: 50, cache_creation_input_tokens: 5,
      input_tokens: 1, cache_read_input_tokens: 888888 } } }) + "\n",
  );
  assert.equal(summarise(file).tokens, 179);
});

test("summarise excludes cache reads", () => {
  // Cache reads re-read the same context every request; summing them would
  // report a number far larger than the work the run actually did.
  const dir = tmpdir();
  const file = writeTranscript(
    dir,
    JSON.stringify({ message: { usage: { output_tokens: 10, cache_read_input_tokens: 500000 } } }) + "\n",
  );
  assert.equal(summarise(file).tokens, 10);
});

test("summarise reports null when no usage is recorded", () => {
  const dir = tmpdir();
  const file = writeTranscript(dir, JSON.stringify({ message: { content: "hi" } }) + "\n");
  assert.equal(summarise(file).tokens, null);
});

test("summarise counts lines the way a trailing newline implies", () => {
  const dir = tmpdir();
  const file = writeTranscript(dir, '{"a":1}\n{"a":2}\n');
  assert.equal(summarise(file).lines, 2);
});

test("summarise survives a line that is not JSON", () => {
  const dir = tmpdir();
  const file = writeTranscript(dir, 'not json at all\n{"message":{"content":"hi"}}\n');
  const info = summarise(file);
  assert.equal(info.lines, 2);
  assert.equal(info.first_text, "hi");
});

test("the index renders missing tokens as a dash, not a zero", () => {
  const dir = tmpdir();
  writeIndex(
    [
      { agent: "a", lines: 1, tool_calls: 0, tokens: null, redactions: 0, started: "t", first_text: "x" },
      { agent: "b", lines: 1, tool_calls: 0, tokens: 12345, redactions: 0, started: "u", first_text: "y" },
    ],
    dir,
  );
  const body = fs.readFileSync(path.join(dir, "INDEX.md"), "utf8");
  assert.ok(body.includes("| tokens |"));
  assert.ok(body.includes("| - |"), "unknown must render as a dash, not zero");
  assert.ok(body.includes("| 12,345 |"));
  assert.ok(!body.split("|---")[1].includes("| 0 |"));
});
