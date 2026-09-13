#!/usr/bin/env node
// Export this session's subagent transcripts into audit_log/ for committing.
//
// Transcripts live inside the ephemeral VM and die with it. This copies them
// into the repository, where git gives them the two properties an audit trail
// needs that the VM cannot: they outlive the machine, and history makes them
// tamper evident.
//
// Every line is passed through a redactor first, because this repository is
// public. The redactor is the load-bearing part: today's transcripts happen to
// contain no real credential, but a future round only has to cat the wrong file
// once, and a secret pushed to a public repository is not undone by deleting it.
//
// Ported from export.py. Node and POSIX shell are the only two things this
// harness needs, and python3 was the third -- worse, the gate that ran its
// tests reported `ok` while pytest was not installed, so the tests had never
// run here or in CI. Ledger rows 47 and 48.
//
// Usage:  node audit_log/export.mjs [--dry-run]

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const OUT = HERE;

// Credential shapes worth redacting. Deliberately anchored on vendor prefixes
// and explicit key names rather than on entropy: a generic "looks random" rule
// eats git SHAs and content hashes, which are exactly what an audit trail needs
// to keep.
const PATTERNS = [
  ["anthropic-key", /sk-ant-[A-Za-z0-9_-]{16,}/g],
  ["openai-key", /sk-[A-Za-z0-9]{32,}/g],
  ["github-token", /gh[pousr]_[A-Za-z0-9]{16,}/g],
  ["github-pat", /github_pat_[A-Za-z0-9_]{20,}/g],
  ["slack-token", /xox[abprs]-[A-Za-z0-9-]{10,}/g],
  ["aws-access-key", /\bAKIA[0-9A-Z]{16}\b/g],
  // Length is deliberately a lower bound, not the exact 35 a real key carries:
  // a filter that misses a credential because it was one character off is
  // worse than one that occasionally masks an innocent AIza-prefixed string.
  ["google-key", /\bAIza[0-9A-Za-z_-]{30,}/g],
  ["bearer", /\bbearer\s+[A-Za-z0-9._-]{20,}/gi],
  ["private-key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/g],
  ["jwt", /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g],
];

// `NAME=value` for names that imply a secret. The placeholder guard keeps
// documentation readable: the archived transcripts contain
// `export ANTHROPIC_API_KEY=your_key_here` a dozen times, read out of a
// CLAUDE.md that told people to run it. Masking a line like that protects
// nobody and makes the transcript harder to follow.
const SECRET_NAME =
  "(?:[A-Z0-9_]*" +
  "(?:SECRET|TOKEN|PASSWORD|PASSWD|APIKEY|API_KEY|ACCESS_KEY|PRIVATE_KEY)" +
  "[A-Z0-9_]*)";
const ASSIGNMENT = new RegExp(`\\b(${SECRET_NAME})=([^\\s"'\\\\,;)]+)`, "g");
const PLACEHOLDER =
  /^(?:your[_-]?\w*|<[^>]*>|\.{3,}|x{3,}|changeme|example\w*|dummy\w*|fake\w*|test\w*|none|null|\$\{?\w+\}?)$/i;

/**
 * Replace a secret with a stable fingerprint.
 *
 * The digest is what makes the redaction useful rather than merely safe: two
 * occurrences of the same credential still match each other across the whole
 * archive, so "the same token was used in both runs" stays answerable without
 * the token itself being readable.
 */
function mask(kind, secret) {
  const digest = crypto.createHash("sha256").update(secret, "utf8").digest("hex").slice(0, 12);
  return `[REDACTED:${kind}:${digest}]`;
}

/** Return the text with credentials masked, and how many were masked. */
export function redact(text) {
  let count = 0;

  for (const [kind, pattern] of PATTERNS) {
    // A fresh regex per call: a /g regex carries lastIndex between uses, and
    // sharing one across calls makes the second call start mid-string and miss
    // the first match. That is a redactor silently letting a credential past.
    text = text.replace(new RegExp(pattern.source, pattern.flags), (m) => {
      count += 1;
      return mask(kind, m);
    });
  }

  text = text.replace(new RegExp(ASSIGNMENT.source, ASSIGNMENT.flags), (whole, name, value) => {
    if (PLACEHOLDER.test(value)) return whole;
    // Already masked. Without this, re-redacting a redacted file rewrites the
    // fingerprint of a value that is no longer a secret, so two archives of
    // the same credential stop matching each other -- which is the one thing
    // the fingerprint exists to preserve. The Python version had this gap and
    // its idempotency test only covered the vendor-prefix path.
    if (value.startsWith("[REDACTED:")) return whole;
    count += 1;
    return `${name}=${mask("env:" + name.toLowerCase(), value)}`;
  });

  return [text, count];
}

/** Every subagent transcript this machine has, sorted. */
export function findTranscripts() {
  const configured = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
  let root = path.join(configured, "projects");
  if (!isDir(root)) root = "/root/.claude/projects";
  if (!isDir(root)) return [];

  // The glob is `*/*/subagents/agent-*.jsonl`. Walked by hand rather than with
  // fs.globSync, which is still experimental in Node 22 and warns on stderr --
  // a hook that prints an experimental warning every run is noise nobody reads.
  const found = [];
  for (const a of readdir(root)) {
    for (const b of readdir(path.join(root, a))) {
      const dir = path.join(root, a, b, "subagents");
      if (!isDir(dir)) continue;
      for (const name of readdir(dir)) {
        if (!name.startsWith("agent-") || !name.endsWith(".jsonl")) continue;
        const full = path.join(dir, name);
        if (isFile(full)) found.push(full);
      }
    }
  }
  return found.sort();
}

const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const isFile = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };
const readdir = (p) => { try { return fs.readdirSync(p).sort(); } catch { return []; } };

/** Read one transcript for the index: size, tool calls, timing, opening text. */
export function summarise(file) {
  let firstText = "";
  let tools = 0;
  let lines = 0;
  let started = null;
  let ended = null;
  // null until a usage record is seen, so "no usage recorded" and "cost
  // nothing" render differently. A run that cost nothing does not exist.
  let tokens = null;

  const body = fs.readFileSync(file, "utf8");
  // Python's splitlines drops the trailing empty field; split does not.
  const rows = body.split(/\r\n|\r|\n/);
  if (rows.length > 0 && rows[rows.length - 1] === "") rows.pop();

  for (const raw of rows) {
    lines += 1;
    let entry;
    try {
      entry = JSON.parse(raw);
    } catch {
      continue;
    }
    if (entry === null || typeof entry !== "object") continue;

    const timestamp = entry.timestamp;
    if (timestamp) {
      started = started || timestamp;
      ended = timestamp;
    }

    const message = entry.message ?? {};
    const usage = message.usage;
    if (usage && typeof usage === "object" && Number.isInteger(usage.output_tokens)) {
      // Output, cache writes and fresh input. Cache *reads* are left out on
      // purpose: every request re-reads the whole context, so summing them
      // across a run reports a number two orders of magnitude larger than the
      // work done, at a rate that is not what it costs.
      const add = ["output_tokens", "cache_creation_input_tokens", "input_tokens"]
        .reduce((sum, k) => sum + (usage[k] || 0), 0);
      tokens = (tokens ?? 0) + add;
    }

    const content = message.content;
    if (Array.isArray(content)) {
      for (const block of content) {
        if (block === null || typeof block !== "object") continue;
        if (block.type === "tool_use") tools += 1;
        else if (block.type === "text" && !firstText) {
          firstText = String(block.text ?? "").split(/\s+/).filter(Boolean).join(" ").slice(0, 120);
        }
      }
    } else if (typeof content === "string" && !firstText) {
      firstText = content.split(/\s+/).filter(Boolean).join(" ").slice(0, 120);
    }
  }

  return {
    agent: path.basename(file, ".jsonl").replace(/^agent-/, ""),
    lines,
    tool_calls: tools,
    tokens,
    started,
    ended,
    first_text: firstText,
  };
}

/**
 * Write the index.
 *
 * The output directory is an argument rather than a module global, so a test
 * can point it somewhere temporary without patching the module. The Python
 * version needed monkeypatch for exactly this.
 */
export function writeIndex(rows, outDir = OUT) {
  const now = new Date().toISOString();
  const stamp = `${now.slice(0, 10)} ${now.slice(11, 19)}Z`;
  const lines = [
    "# Run index",
    "",
    `Regenerated in full by \`audit_log/export.mjs\`. Last run ${stamp}.`,
    "",
    "| agent | lines | tool calls | tokens | redactions | started | opening text |",
    "|---|---|---|---|---|---|---|",
  ];
  const sorted = [...rows].sort((a, b) =>
    String(a.started || "").localeCompare(String(b.started || "")),
  );
  for (const row of sorted) {
    const text = String(row.first_text ?? "").replaceAll("|", "\\|");
    // A dash, never a zero: a run with no usage records is not a run that cost
    // nothing, and rendering them the same way loses the difference.
    const tok = Number.isInteger(row.tokens) ? row.tokens.toLocaleString("en-US") : "-";
    lines.push(
      `| \`${row.agent}\` | ${row.lines} | ${row.tool_calls} | ${tok} ` +
        `| ${row.redactions} | ${row.started || "-"} | ${text} |`,
    );
  }
  fs.writeFileSync(path.join(outDir, "INDEX.md"), lines.join("\n") + "\n", "utf8");
}

function main() {
  const dryRun = process.argv.includes("--dry-run");
  const unknown = process.argv.slice(2).filter((a) => a !== "--dry-run");
  if (unknown.length > 0) {
    console.error(`unknown argument: ${unknown[0]}`);
    console.error("usage: node audit_log/export.mjs [--dry-run]");
    return 2;
  }

  const transcripts = findTranscripts();
  if (transcripts.length === 0) {
    console.error("no subagent transcripts found");
    return 1;
  }

  const runs = path.join(OUT, "runs");
  const rows = [];
  let totalRedactions = 0;
  let written = 0;

  for (const file of transcripts) {
    const [clean, redactions] = redact(fs.readFileSync(file, "utf8"));
    totalRedactions += redactions;
    const info = summarise(file);
    info.redactions = redactions;
    rows.push(info);

    const target = path.join(runs, `${info.agent}.jsonl`);
    if (dryRun) {
      written += 1;
      continue;
    }
    // A finished agent's transcript never changes, so skipping identical files
    // keeps the archive append-only: re-running the export adds new runs
    // without producing a fresh git object for every old one.
    try {
      if (fs.readFileSync(target, "utf8") === clean) continue;
    } catch {}
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, clean, "utf8");
    written += 1;
  }

  if (!dryRun) writeIndex(rows);

  const verb = dryRun ? "would export" : "exported";
  console.log(`${verb} ${written}/${transcripts.length} transcripts, ${totalRedactions} redactions`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main());
}
