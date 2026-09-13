// security/arena.mjs
//
// Runs the inert adversary against both a NAIVE scanner (the "article-level"
// defence: match the known-bad substring) and the structural container. It
// prints the contrast and then asserts the strong claim:
//
//   * the naive scanner is evaded by the mutation vectors, and
//   * the container contains every malicious vector AND passes the benign one.
//
// Exit non-zero if either claim fails -- a guard that bites, in this repo's
// vocabulary. This file is the demo AND the check.

import { campaign, INERT_SENTINEL } from "./adversary.mjs";
import { contain, inspect } from "./container.mjs";

// The defence you get from a blog post: grep the bytes for the classic form.
function naiveScan(artifact) {
  if (!artifact.weights) return { verdict: "clean" };
  const s = artifact.weights.toString("latin1");
  const bad = s.includes("cos\nsystem\n") || s.includes("csubprocess\n");
  return { verdict: bad ? "critical" : "clean" };
}

export function runArena() {
  const arts = campaign();
  const rows = [];
  let naiveMisses = 0;
  let escapes = 0;
  let falsePositives = 0;

  for (const a of arts) {
    const naive = naiveScan(a);
    const report = inspect(a);
    const naiveCaught = naive.verdict !== "clean";
    const contained = report.contained;

    if (a.malicious && !naiveCaught) naiveMisses++;
    if (a.malicious && !contained) escapes++;
    if (!a.malicious && contained) falsePositives++;

    rows.push({
      id: a.id,
      vector: a.vector,
      expect: a.malicious ? "block" : "pass",
      naive: naiveCaught ? "caught" : "missed",
      container: report.verdict,
      contained,
    });
  }

  return { rows, naiveMisses, escapes, falsePositives, sentinel: INERT_SENTINEL };
}

function main() {
  const r = runArena();
  const pad = (s, n) => String(s).padEnd(n);
  console.log("\n  Adversary vs container  (all payloads inert: %s)\n", r.sentinel);
  console.log("  %s %s %s %s", pad("artifact", 20), pad("expect", 7), pad("naive", 8), "container");
  console.log("  %s", "-".repeat(64));
  for (const row of r.rows) {
    const ok = row.expect === "block" ? row.contained : !row.contained;
    console.log("  %s %s %s %s %s",
      pad(row.id, 20), pad(row.expect, 7), pad(row.naive, 8),
      pad(row.container + (row.contained ? " (held)" : ""), 18), ok ? "OK" : "**FAIL**");
  }
  console.log("");
  console.log("  naive scanner evaded by %d/%d malicious vectors", r.naiveMisses,
    r.rows.filter((x) => x.expect === "block").length);
  console.log("  container escapes: %d   false positives: %d", r.escapes, r.falsePositives);

  const claim1 = r.naiveMisses > 0;               // the article-level defence is beaten
  const claim2 = r.escapes === 0 && r.falsePositives === 0; // the container is not
  if (!claim1) {
    console.error("\n  UNMET: expected the naive scanner to be evaded by at least one vector.");
    process.exit(1);
  }
  if (!claim2) {
    console.error("\n  UNMET: container let a malicious vector through or flagged a benign one.");
    process.exit(1);
  }
  console.log("\n  Contained. The mutation that beats the naive scanner does not beat the structural one.\n");
}

if (import.meta.url === `file://${process.argv[1]}`) main();
