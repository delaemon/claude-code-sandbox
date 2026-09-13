// Turn a gates.sh run into JSON.
//
// It exists so that nothing has to parse gates.sh's human output. That output
// is coloured when a terminal is watching and plain when it is piped, and this
// repository has already shipped a check that read a runner's summary text and
// therefore gave a different verdict depending on where it ran -- ledger row 23.
// A caller that needs results is handed results.
//
// Usage:  node scripts/gates-report.mjs <results-dir>
//
// The directory holds an `index` of `seq<TAB>exit<TAB>label` lines and one
// `<seq>.out` per gate. The status vocabulary is the harness's own:
//
//   ok       exit 0   ran, passed
//   fail     exit 1   ran, failed
//   broken   exit 2   could not look -- still a failure
//   skipped  exit 3   not configured
//   not-run  exit 4   this tier did not run it
//
// `skipped` and `not-run` are deliberately different words. One means the check
// has nothing to point at; the other means it was not asked. Neither is a pass,
// and collapsing them would lose which of the two a person has to act on.
import fs from "node:fs";
import path from "node:path";

const dir = process.argv[2];
if (!dir) {
  console.error("usage: node scripts/gates-report.mjs <results-dir>");
  process.exit(2);
}

let index;
try {
  index = fs.readFileSync(path.join(dir, "index"), "utf8");
} catch {
  // No index at all means no gate ran. Emitting an empty, passing report would
  // be a green verdict from a run that did nothing.
  console.error(`No gate results in ${dir}. Refusing to report that as a pass.`);
  process.exit(2);
}

const STATUS = { 0: "ok", 1: "fail", 2: "broken", 3: "skipped", 4: "not-run" };

const gates = [];
for (const line of index.split("\n")) {
  if (!line.trim()) continue;
  const [seq, code, ...rest] = line.split("\t");
  const label = rest.join("\t");
  let output = "";
  try {
    output = fs.readFileSync(path.join(dir, `${seq}.out`), "utf8");
  } catch {}
  gates.push({
    gate: label,
    status: STATUS[Number(code)] ?? "broken",
    exit: Number(code),
    // ANSI out. Whatever reads this next should not have to know that a runner
    // colours its own summary.
    output: output.replace(/\[[0-9;]*m/g, "").trimEnd(),
  });
}

if (gates.length === 0) {
  console.error("The index held no gates. Refusing to report that as a pass.");
  process.exit(2);
}

const count = (s) => gates.filter((g) => g.status === s).length;
const failing = count("fail") + count("broken");

process.stdout.write(
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      // "green" is true only when something ran and nothing failed. A run of
      // nothing but not-run is not green, and saying so here means every
      // consumer gets that right without repeating the reasoning.
      green: failing === 0 && count("ok") > 0,
      ran: count("ok") + failing,
      failing,
      totals: {
        ok: count("ok"),
        fail: count("fail"),
        broken: count("broken"),
        skipped: count("skipped"),
        notRun: count("not-run"),
      },
      gates,
    },
    null,
    2,
  ) + "\n",
);
