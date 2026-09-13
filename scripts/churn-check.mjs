// Does usage.md still hold still across an ordinary turn?
//
// Rounding is the only thing stopping that file changing on every stop, and
// nothing asserted it still did. This is that assertion -- and the first
// version of it, written inside doctor.sh, failed every way a check can:
//
//   it passed when the hook was deleted      -- `cksum < missing` twice gives
//                                               two empty strings, which compare
//                                               equal, which read as "unchanged"
//   it passed when the token column was gone  -- nothing left to round
//   it missed a tightening below 12.5x        -- its probe sat exactly on a
//                                               500,000 boundary, the most
//                                               forgiving alignment there is
//   it was built with python3                 -- against this repository's own
//                                               rule, and skipped invisibly
//
// So: node only, a positive assertion before any comparison, and probes chosen
// to straddle the boundaries a tightened granularity would introduce.
//
// Usage:  node scripts/churn-check.mjs
// Exit 0 when the file holds still, 1 when it churns, 2 when it could not look.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const repo = path.resolve(path.dirname(process.argv[1]), "..");
const hook = path.join(repo, ".claude/hooks/log-usage.sh");

// Each record is 5,000 tokens. The pairs below all round to the same value at
// 500,000 and to different values at the granularity named, so any tightening
// to 250,000 or below is caught. A pair straddling a boundary is the point: the
// old probe used 5,000,000, which sits on one.
const PAIRS = [
  { catches: 50_000, a: 1004, b: 1006 },
  { catches: 100_000, a: 1008, b: 1012 },
  { catches: 250_000, a: 1024, b: 1026 },
];

// The hook truncates session ids to eight characters, so the row reads
// `churnpro`. Looking for the full name finds nothing -- the fourth time in
// this repository that an assertion has searched for a value using its spelling
// from before the code transformed it. Derived here rather than written twice.
const SESSION = "churnprobe";
const ROW_ID = SESSION.slice(0, 8);

const record = JSON.stringify({ message: { usage: {
  output_tokens: 900, cache_creation_input_tokens: 4100, input_tokens: 0 } } });

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "churn-"));
const cleanup = () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} };

function runHook(records, tag) {
  const transcript = path.join(dir, `${tag}.jsonl`);
  fs.writeFileSync(transcript, Array(records).fill(record).join("\n") + "\n");
  const usage = path.join(dir, "usage.md");
  execFileSync("bash", [hook], {
    input: JSON.stringify({ session_id: SESSION, transcript_path: transcript }),
    env: { ...process.env,
      USAGE_LOG: usage,
      TURNS_LOG: path.join(dir, "turns.jsonl"),
      SUBAGENT_CACHE: path.join(dir, "cache.json") },
    cwd: repo, stdio: ["pipe", "pipe", "pipe"],
  });
  return usage;
}

try {
  // A positive first. Two identical absences must never read as "unchanged".
  const first = runHook(PAIRS[0].a, "warm");
  if (!fs.existsSync(first)) {
    console.error("The hook wrote no usage.md at all. Nothing to compare, and");
    console.error("two missing files must not read as a file that held still.");
    process.exit(2);
  }
  const sample = fs.readFileSync(first, "utf8");
  const row = sample.split("\n").find((l) => l.startsWith(`| \`${ROW_ID}\``));
  if (!row) {
    console.error("usage.md has no row for the probe session — the hook ran but");
    console.error("recorded nothing, so rounding cannot be what is being tested.");
    process.exit(2);
  }
  if (!/~[\d,]+\s*\|/.test(row.split("|").slice(3).join("|"))) {
    console.error(`No rounded token figure in the row: ${row.trim()}`);
    console.error("The column this check measures is gone, so it measures nothing.");
    process.exit(2);
  }

  const churned = [];
  for (const pair of PAIRS) {
    fs.rmSync(path.join(dir, "usage.md"), { force: true });
    const before = fs.readFileSync(runHook(pair.a, "a"), "utf8");
    const after = fs.readFileSync(runHook(pair.b, "b"), "utf8");
    if (before !== after) {
      churned.push(`${(pair.b - pair.a) * 5000} tokens moved the file `
        + `(a granularity of ${pair.catches.toLocaleString("en-US")} or tighter)`);
    }
  }

  if (churned.length > 0) {
    console.error("usage.md changes on an ordinary turn — the churn is back:");
    for (const c of churned) console.error(`  ${c}`);
    process.exit(1);
  }
  console.log(`usage.md holds still across ${PAIRS.length} probes `
    + `(catches any granularity of 250,000 or tighter)`);
} finally {
  cleanup();
}
