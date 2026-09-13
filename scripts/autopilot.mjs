// Turn a gate run into a work order: what broke, what it means, what to do.
//
// `gates.sh` answers "is this ready to push". It is deliberately a wall of
// output when something is wrong, because when a person is looking, the output
// is the evidence. This is the other half: the thing that reads that run and
// says *which one thing to do next*.
//
// It exists because the loop this repository automates had one manual step left
// in it. Everything else is executed by the harness -- hooks run, CI runs,
// gates run -- and then a human or an agent had to read fourteen results, work
// out which failure caused the others, and decide where to start. That step is
// where sessions went wrong: fixing a test that was only failing because the
// typecheck was, or reporting a red gate back as a question.
//
// Three things it does that reading the output does not:
//
//   1. **Orders by what causes what.** A broken environment makes every other
//      result meaningless; a failing typecheck makes the test run meaningless.
//      The first entry is the one to fix, not the first one that happened to
//      run.
//   2. **Extracts the line that matters.** Each gate fails in a shape this file
//      knows -- `error TS`, `SURVIVED`, `NOT caught` -- so the order carries
//      the evidence rather than three hundred lines around it.
//   3. **Says what did not run.** A work order listing two failures out of a
//      tier that skipped ten checks would read as "two things left to do". It
//      is not: it is two things left to do and ten questions not yet asked.
//
// Usage:
//   node scripts/autopilot.mjs [--fast|--quick] [--json] [--from FILE]
//
//   --from FILE   read a gates.sh --json report instead of running one
//   --json        emit the work order as JSON rather than as text
//
// Exit 0 when there is nothing to do, 1 when there is, 2 when it could not look.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { REPO } from "./config.mjs";

const argv = process.argv.slice(2);
const asJson = argv.includes("--json");
const fromIdx = argv.indexOf("--from");
const tier = argv.includes("--fast") ? "--fast" : argv.includes("--quick") ? "--quick" : null;

// ── the report ──────────────────────────────────────────────────────────────
let report;
if (fromIdx !== -1) {
  const file = argv[fromIdx + 1];
  if (!file) {
    console.error("--from needs a file. Refusing to fall back to running the gates,");
    console.error("which would answer a different question than the one asked.");
    process.exit(2);
  }
  try {
    report = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    console.error(`Could not read a gate report from ${file}: ${e.message}`);
    process.exit(2);
  }
} else {
  const args = ["scripts/gates.sh", "--json"];
  if (tier) args.push(tier);
  const run = spawnSync("bash", args, { cwd: REPO, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (run.error) {
    console.error(`Could not run the gates: ${run.error.message}`);
    process.exit(2);
  }
  try {
    report = JSON.parse(run.stdout);
  } catch {
    // gates.sh exiting without parseable JSON is a broken harness, not a pass.
    console.error("gates.sh --json produced nothing this could parse.");
    console.error((run.stderr || run.stdout || "").split("\n").slice(-15).join("\n"));
    process.exit(2);
  }
}

if (!Array.isArray(report.gates) || report.gates.length === 0) {
  console.error("The gate report lists no gates. Refusing to call that green.");
  process.exit(2);
}

// ── what each gate means, and what to do about it ───────────────────────────
//
// Ordered by what causes what. The list is the priority: a gate earlier here
// invalidates the ones after it, so fixing in this order never means fixing
// something that was only failing because of something else.
//
// `lines` pulls the evidence out of that gate's own output shape. When a gate
// is not listed here the order still carries it, with the tail of its output --
// unknown is not a reason to say nothing.
const KNOWN = [
  {
    gate: "environment",
    means: "this machine does not satisfy what the flow assumes",
    next: "read the FAIL lines from scripts/doctor.sh — a hook is not behaving as its contract says",
    lines: (o) => grep(o, /^\s*FAIL\s/),
  },
  {
    gate: "typecheck",
    means: "the application does not compile",
    next: "fix the type errors first — every result below this was produced against code that does not build",
    lines: (o) => grep(o, /error TS\d+/),
  },
  {
    gate: "tests",
    means: "the suite is failing",
    next: "fix the failing assertions, or the code they are right about",
    lines: (o) => grep(o, /^\s*(FAIL|AssertionError|→|Tests\s+\d+\s+failed)/),
  },
  {
    gate: "clock boundary",
    means: "a clock or a random source escaped the one file allowed to hold one",
    next: "move it back behind the boundary, or take the value as an argument — the file:line is above",
    lines: (o) => grep(o, /^\s*\S+:\d+:/),
  },
  {
    gate: "smoke (browser)",
    means: "the application is broken in a browser, where the unit suite cannot see",
    next: "this is the shell — main.ts and what it renders. The failing check names what a player would see",
    lines: (o) => grep(o, /^\s*FAIL\s/),
  },
  {
    gate: "mutation",
    means: "the suite would not notice a real bug",
    next: "a SURVIVED mutant names a claim nothing asserts. Add the assertion; do not delete the mutant",
    lines: (o) => grep(o, /^\s*(SURVIVED|BROKEN|MISS)\b/),
  },
  {
    gate: "harness evals",
    means: "a failure the ledger says is caught is no longer caught",
    next: "a guard has been weakened, possibly by a change somewhere else entirely — the case names the ledger row",
    lines: (o) => grep(o, /^\s*FAIL\s/),
  },
  {
    gate: "eval runner",
    means: "the suite that replays every other check cannot report what it found",
    next: "nothing the eval suite says can be trusted until this passes",
    lines: (o) => grep(o, /^\s*FAIL\s/),
  },
  {
    gate: "failure ledger",
    means: "a ledger row names a check that does not exist",
    next: "either restore the check or the failure can happen again — do not edit the row to match",
    lines: (o) => grep(o, /no such check|^\s*open\s/),
  },
  {
    gate: "ci trigger",
    means: "CI would not run on the integration branch",
    next: "harness.config.json and .github/workflows/ci.yml disagree about the branch; `on:` cannot read the config, so both must be edited",
    lines: (o) => grep(o, /only runs on push|declares no/),
  },
  {
    gate: "same everywhere",
    means: "doctor.sh runs different checks in different environments",
    next: "a check that needs this machine to be a particular machine is a check that does not run",
    lines: (o) => grep(o, /skipped without|only without/),
  },
  {
    gate: "agent behaviour",
    means: "this change weakens a guard on what the agent may do",
    next: "adding a guard is never blocked; removing one is. Restore it, or say in the PR that it is deliberate",
    lines: (o) => grep(o, /^\s*-\s/),
  },
  {
    gate: "usage churn",
    means: "the usage log has started changing on every turn again",
    next: "a tracked file that changes every turn has no quiet state — ledger rows 6 and 25",
    lines: (o) => tail(o, 3),
  },
  {
    gate: "audit log tests",
    means: "audit_log's own tests are failing",
    next: "run python3 -m pytest audit_log/test_export.py -q",
    lines: (o) => tail(o, 6),
  },
];

function grep(output, re) {
  const hit = output.split("\n").filter((l) => re.test(l));
  return hit.length > 0 ? hit.slice(0, 8) : tail(output, 4);
}
function tail(output, n) {
  return output.split("\n").filter((l) => l.trim()).slice(-n);
}

const rank = (name) => {
  const i = KNOWN.findIndex((k) => k.gate === name);
  return i === -1 ? KNOWN.length : i;
};

// ── the order ───────────────────────────────────────────────────────────────
const broken = report.gates
  .filter((g) => g.status === "fail" || g.status === "broken")
  .sort((a, b) => rank(a.gate) - rank(b.gate))
  .map((g) => {
    const known = KNOWN.find((k) => k.gate === g.gate);
    return {
      gate: g.gate,
      status: g.status,
      // A gate exiting 2 could not look at all. That is a different job from a
      // gate that looked and disagreed, and saying which saves the reader from
      // hunting for a disagreement that is not there.
      means: g.status === "broken"
        ? `the check itself could not run — ${known?.means ?? "it exited 2"}`
        : known?.means ?? "this gate failed",
      next: g.status === "broken"
        ? "repair the check before trusting anything it or the gates after it said"
        : known?.next ?? "read the evidence below",
      evidence: (known?.lines ?? ((o) => tail(o, 6)))(g.output),
    };
  });

const notRun = report.gates.filter((g) => g.status === "not-run").map((g) => g.gate);
const unconfigured = report.gates.filter((g) => g.status === "skipped").map((g) => g.gate);

const order = {
  green: broken.length === 0,
  ran: report.ran ?? 0,
  // Complete only when something ran, nothing failed, and nothing was left
  // unasked. The three are different and the distinction is the whole point.
  complete: broken.length === 0 && notRun.length === 0 && (report.ran ?? 0) > 0,
  work: broken,
  notRun,
  unconfigured,
};

if (asJson) {
  process.stdout.write(JSON.stringify(order, null, 2) + "\n");
  process.exit(order.green ? 0 : 1);
}

// ── as text ─────────────────────────────────────────────────────────────────
const out = [];
if (broken.length === 0) {
  out.push(order.complete
    ? `gates: all ${order.ran} pass`
    : `gates: ${order.ran} pass in this tier`);
} else {
  out.push(`gates: ${broken.length} failing of ${order.ran} run — in the order to fix them`);
  broken.forEach((w, i) => {
    out.push("");
    out.push(`${i + 1}. ${w.gate} — ${w.means}`);
    for (const line of w.evidence) out.push(`     ${line.trim()}`);
    out.push(`   → ${w.next}`);
  });
}
if (notRun.length > 0) {
  out.push("");
  out.push(`not asked in this tier: ${notRun.join(", ")}`);
  out.push("  → bash scripts/gates.sh  (these have neither passed nor failed)");
}
if (unconfigured.length > 0) {
  out.push("");
  out.push(`not configured: ${unconfigured.join(", ")}`);
}
console.log(out.join("\n"));
process.exit(order.green ? 0 : 1);
