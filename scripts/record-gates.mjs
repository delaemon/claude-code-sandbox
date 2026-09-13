// Record what each gate did, so "which gates are worth having" can be measured.
//
// Every gate in this repository exists because something went wrong once. That
// is how the list got to seventeen, and nothing has ever said which of the
// seventeen still earns the two minutes it costs. A harness can only grow under
// those conditions: each failure adds a gate, no gate is ever removed, and the
// cost of the whole set is paid on every run by whoever is working.
//
// So each run appends one line: which gates ran, and what each of them did.
// scripts/yield.mjs reads the accumulated lines. Nothing here judges anything --
// the record is the point, and the judgement is a separate program, because a
// recorder that also decided what the numbers meant would be the only witness
// to its own verdict.
//
// Written to a STAGED path git ignores, folded into the tracked log by
// scripts/fold-logs.mjs when the next run of the gates folds. A tracked file
// that changes on every run has no quiet state -- ledger row 25, the loop that
// sustained itself for an hour at about a commit a minute.
//
// Usage:  node scripts/record-gates.mjs <results-dir> <tier>
// Exit 0 when the line landed, 1 when it could not be written. Never silent:
// gates.sh says so on the run, because a recorder that quietly stops leaves
// yield.mjs reporting a frozen history that still looks like data.
import fs from "node:fs";
import path from "node:path";

const repo = path.resolve(path.dirname(process.argv[1]), "..");
const dir = process.env.AUDIT_DIR || path.join(repo, "audit_log");
const STAGED = ".gate-results-pending.jsonl";

// A run pointed at a fixture is not a run of this harness's gates.
//
// doctor.sh drives gates.sh against evals/fixtures/ to assert things about the
// runner itself -- that an application command exiting 3 is a failed gate, that
// a run leaves a record at all. Those runs were landing in the real log, so the
// `tests` gate showed nine failures that were a fixture failing on purpose.
// A diagnostic contaminating the record it checks is ledger row 12, arriving
// again on the day the record was introduced.
//
// The rule is one nobody has to remember: a run against a fixture either says
// where to record itself, or it is not recorded. Keeping a list of probes that
// must pass AUDIT_DIR would be the hand-maintained list of row 40, stale by the
// next probe somebody adds.
if (process.env.HARNESS_CONFIG && !process.env.AUDIT_DIR) process.exit(0);

const [resultsDir, tier] = process.argv.slice(2);
if (!resultsDir || !tier) {
  console.error("usage: node scripts/record-gates.mjs <results-dir> <tier>");
  process.exit(1);
}

// Same vocabulary as scripts/gates-report.mjs. `skipped` and `not-run` stay
// different words: one means the check has nothing to point at, the other means
// this tier did not ask it. Collapsing them would make a gate that is switched
// off indistinguishable from one that is merely quiet, which is the whole
// question yield.mjs is trying to answer.
const STATUS = { 0: "ok", 1: "fail", 2: "broken", 3: "skipped", 4: "not-run" };

let index;
try {
  index = fs.readFileSync(path.join(resultsDir, "index"), "utf8");
} catch {
  console.error(`No gate results in ${resultsDir} to record.`);
  process.exit(1);
}

const gates = {};
for (const line of index.split("\n")) {
  if (!line.trim()) continue;
  const [, code, ...rest] = line.split("\t");
  const label = rest.join("\t");
  if (!label) continue;
  gates[label] = STATUS[Number(code)] ?? "broken";
}

if (Object.keys(gates).length === 0) {
  console.error("The index held no gates. Refusing to record an empty run as one that happened.");
  process.exit(1);
}

const record = {
  at: new Date().toISOString(),
  tier,
  gates,
};

try {
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(path.join(dir, STAGED), JSON.stringify(record) + "\n");
} catch (e) {
  console.error(`Could not record this run: ${e.message}`);
  process.exit(1);
}
