// Which gates have ever caught anything here?
//
// Every gate in this repository exists because something went wrong once, and
// that is the only force acting on the list. Failures add gates; nothing
// removes one. Seventeen of them cost about two minutes on every full run, and
// until this existed there was no way to ask which of the seventeen had ever
// paid for that -- so "the harness is worth it" was a belief, in a repository
// whose one rule is that a claim nobody can check is not a claim.
//
// This is the check. Two sources, neither of them an opinion:
//
//   audit_log/gate-results.jsonl   what each gate DID, one line per run,
//                                  appended by scripts/record-gates.mjs
//   docs/LEDGER.md                 what each gate was BUILT for, one row per
//                                  failure, each naming the check that catches
//                                  it now
//
// The two answer different halves. A gate can be quiet for a hundred runs and
// still be the reason a class of failure stopped happening; a gate with four
// ledger rows and no observed failure in months is a gate whose bugs a team has
// learned not to write. Both facts are reported, and neither is collapsed into
// a score.
//
// **This is a report, not a gate.** It never exits 1. Deciding that a check has
// stopped earning its place is a judgement about a codebase and a team, and a
// program that made it automatically would delete the guard whose whole value
// is that the failure has not recurred. What the harness enforces is that the
// numbers exist and are honest; what to do about them is a person's.
//
// Usage:  node scripts/yield.mjs [--json] [--min-runs N]
// Exit 0 when a report was produced, 3 when nothing has been recorded yet --
// did-not-run, not zero yield. An empty history and a gate that never bites
// look identical in a table of zeros, and saying so is the whole point.
import fs from "node:fs";
import path from "node:path";
import { REPO } from "./config.mjs";

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const minRunsArg = args.indexOf("--min-runs");
// Below this many recorded runs a gate is reported as "not enough evidence"
// rather than as quiet. Ten is arbitrary and says so; what is not arbitrary is
// that some floor exists, because "failed 0 times in 2 runs" is not a finding.
const MIN_RUNS = minRunsArg >= 0 ? Number(args[minRunsArg + 1]) : 10;

const AUDIT = process.env.AUDIT_DIR || path.join(REPO, "audit_log");
const LOG = path.join(AUDIT, "gate-results.jsonl");
const STAGED = path.join(AUDIT, ".gate-results-pending.jsonl");
const GATES = path.join(REPO, "scripts/gates.sh");
const LEDGER = path.join(REPO, "docs/LEDGER.md");

const die = (code, ...lines) => {
  for (const l of lines) console.error(l);
  process.exit(code);
};

// -- what gates.sh currently asks -------------------------------------------
//
// Labels, not commands: the record is keyed by label, because that is the name
// a person sees and the name a ledger row is read against.
let gatesText;
try {
  gatesText = fs.readFileSync(GATES, "utf8");
} catch {
  die(2, "No scripts/gates.sh to read the gate list from.",
      "Refusing to report yield for a list of gates that is not there.");
}

const current = [];       // label, in the order gates.sh runs them
const commandOf = {};     // label -> the command, where gates.sh runs one
for (const line of gatesText.split("\n")) {
  if (/^\s*#/.test(line)) continue;
  for (const m of line.matchAll(/\b(run|app_gate|skip)\s+"([^"]+)"/g)) {
    const label = m[2];
    // `run "$label" ...` is the app-gate plumbing calling run with a variable,
    // not a gate of its own. The real labels arrive through app_gate.
    if (label.startsWith("$")) continue;
    if (!current.includes(label)) current.push(label);
    if (m[1] === "run") {
      const cmd = line.slice(m.index + m[0].length).trim();
      if (cmd && !cmd.startsWith('bash -c "printf')) commandOf[label] ??= cmd;
    }
  }
}
if (current.length === 0) {
  die(2, "Found no gates in scripts/gates.sh.",
      "Refusing to report on the yield of an empty list.");
}

// -- what the gates have done -----------------------------------------------
const readLines = (file) => {
  let body;
  try { body = fs.readFileSync(file, "utf8"); } catch { return []; }
  const out = [];
  for (const line of body.split("\n")) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch {
      // A line that will not parse is reported, never skipped quietly: a log
      // half of which is unreadable is not the same thing as a shorter log.
      out.push({ __bad: line.slice(0, 80) });
    }
  }
  return out;
};

const records = [...readLines(LOG), ...readLines(STAGED)];
const bad = records.filter((r) => r.__bad);
const runs = records.filter((r) => !r.__bad && r.gates && typeof r.gates === "object");

if (runs.length === 0) {
  die(3, "No gate runs have been recorded yet.",
      `${path.relative(REPO, LOG)} is empty or absent, so there is nothing to`,
      "measure. Reporting did-not-run rather than a table of zeros: an empty",
      "history and a gate that never bites look identical in one.");
}

// -- per gate ---------------------------------------------------------------
const stats = {};
const seed = (label) => (stats[label] ??= {
  gate: label, runs: 0, failed: 0, broken: 0, skipped: 0, notRun: 0,
  lastFailure: null, current: current.includes(label),
});

for (const rec of runs) {
  for (const [label, status] of Object.entries(rec.gates)) {
    const s = seed(label);
    if (status === "ok" || status === "fail" || status === "broken") s.runs += 1;
    if (status === "fail") { s.failed += 1; s.lastFailure = rec.at ?? s.lastFailure; }
    if (status === "broken") { s.broken += 1; s.lastFailure = rec.at ?? s.lastFailure; }
    if (status === "skipped") s.skipped += 1;
    if (status === "not-run") s.notRun += 1;
  }
}
for (const label of current) seed(label);

// -- what each gate was built for -------------------------------------------
//
// A ledger row names the check that catches its failure: either a file, or a
// doctor.sh assertion label. Both are attributed here -- the second to the
// `environment` gate, which is what runs doctor.sh.
let ledgerText;
try {
  ledgerText = fs.readFileSync(LEDGER, "utf8");
} catch {
  die(2, "No docs/LEDGER.md.",
      "Half the question -- what each gate was built for -- cannot be answered.",
      "A report answering only the other half would read as a complete one.");
}

// Split on pipes that are not escaped, so a failure description containing one
// does not shift every column after it.
const cells = (row) => row.split(/(?<!\\)\|/).map((c) => c.trim());

const ledgerRows = [];
for (const line of ledgerText.split("\n")) {
  if (!/^\|\s*\d+\s*\|/.test(line)) continue;
  const c = cells(line);
  const [, num, , check] = c;
  ledgerRows.push({ row: Number(num), check: (check ?? "").replace(/`/g, "") });
}
if (ledgerRows.length === 0) {
  die(2, "docs/LEDGER.md has no rows this could read.",
      "Refusing to report that no gate was built for a recorded failure.");
}

const scriptOf = (cmd) => (cmd ?? "").match(/([\w./-]+\.(?:mjs|sh))/)?.[1] ?? null;
const attribute = (check) => {
  if (!check || check === "-") return null;
  // A path: match it against the script each gate runs.
  if (check.includes("/")) {
    for (const label of current) {
      const s = scriptOf(commandOf[label]);
      if (s && (check === s || check.endsWith(s))) return label;
    }
    // app/smoke.mjs is the application's own script, driven by the smoke gate.
    if (check.startsWith("app/")) return "smoke (browser)";
    return null;
  }
  // Not a path: a doctor.sh assertion label. doctor.sh is the `environment`
  // gate, so that is the gate which carries the row.
  return "environment";
};

const rowsFor = {};
const unattributed = [];
for (const r of ledgerRows) {
  const label = attribute(r.check);
  if (label) (rowsFor[label] ??= []).push(r.row);
  else unattributed.push(r);
}

// Which half of the work each recorded failure came out of. Classified by the
// gate that catches it, mechanically -- the application gates are the five that
// need an `app.dir`, everything else is the harness inspecting itself. This is
// the number that says whether a harness is paying off its own construction or
// earning on the code it is pointed at.
const APP_GATES = new Set(["typecheck", "tests", "clock boundary", "smoke (browser)", "mutation"]);
const origin = { application: 0, harness: 0, noNamedGate: unattributed.length };
for (const [label, rows] of Object.entries(rowsFor)) {
  origin[APP_GATES.has(label) ? "application" : "harness"] += rows.length;
}
// A row whose check no named gate runs is still a failure of one side or the
// other. Placed by where the check lives, so the split stays readable -- and
// listed separately below, because "the ledger names a check nothing in
// gates.sh runs" is a finding in its own right.
for (const r of unattributed) {
  origin[r.check.startsWith("app/") ? "application" : "harness"] += 1;
}

// -- verdicts ---------------------------------------------------------------
//
// The boundaries between them are the honest part. "Quiet" is only said of a
// gate with enough runs behind it, and it is never said of a gate that a ledger
// row explains -- the failure not recurring is what that gate is for.
const verdict = (s) => {
  const rows = rowsFor[s.gate] ?? [];
  if (!s.current) return "gone";
  // Two different zeros. A gate every recorded run listed as not-run was asked
  // of no tier that was recorded -- run the full tier and the evidence appears.
  // A gate absent from the record altogether has never been executed at all.
  if (s.runs === 0 && s.notRun + s.skipped > 0) return "not-asked";
  if (s.runs === 0) return "unobserved";
  if (s.failed + s.broken > 0) return "biting";
  if (rows.length > 0) return "holding";
  if (s.runs < MIN_RUNS) return "too-early";
  return "quiet";
};

const WHY = {
  biting: "has failed here — it is catching something",
  holding: "no failure observed, but the ledger says why it exists",
  quiet: "never failed here, and no ledger row explains it",
  "too-early": `fewer than ${MIN_RUNS} runs — not enough to say anything`,
  "not-asked": "recorded only as not-run — no recorded tier has run it",
  unobserved: "in gates.sh and absent from the record entirely — never executed",
  gone: "recorded in the past, no longer in gates.sh",
};

const all = Object.values(stats).sort((a, b) => current.indexOf(a.gate) - current.indexOf(b.gate));
for (const s of all) { s.verdict = verdict(s); s.ledgerRows = rowsFor[s.gate] ?? []; }

const tiers = {};
for (const r of runs) tiers[r.tier ?? "?"] = (tiers[r.tier ?? "?"] ?? 0) + 1;
const times = runs.map((r) => r.at).filter(Boolean).sort();

if (asJson) {
  process.stdout.write(JSON.stringify({
    generatedAt: new Date().toISOString(),
    runs: runs.length,
    tiers,
    firstRun: times[0] ?? null,
    lastRun: times[times.length - 1] ?? null,
    unreadableLines: bad.length,
    minRuns: MIN_RUNS,
    ledgerRows: ledgerRows.length,
    origin,
    gates: all,
    unattributed: unattributed.map((r) => ({ row: r.row, check: r.check })),
  }, null, 2) + "\n");
  process.exit(0);
}

// Colour only when a terminal is watching. This output goes into a CI run
// summary, where escape codes render as literal noise -- and ledger row 23 is
// what happens when a program's output differs depending on where it ran.
const colour = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
const ESC = "\u001b";
const dim = colour ? `${ESC}[2m` : "", off = colour ? `${ESC}[0m` : "",
      bold = colour ? `${ESC}[1m` : "";
const day = (t) => (t ? t.slice(0, 10) : "—");

console.log(`${bold}gate yield${off} — what each gate has actually done here`);
console.log("");
console.log(`  ${runs.length} recorded run(s) ${dim}(${Object.entries(tiers).map(([t, n]) => `${t} ${n}`).join(", ")})${off}` +
            `  ${dim}${day(times[0])} to ${day(times[times.length - 1])}${off}`);
if (bad.length > 0) {
  console.log(`  ${bad.length} line(s) of the record could not be parsed and are not counted`);
}
console.log("");

const w = Math.max(...all.map((s) => s.gate.length), 4);
console.log(`  ${"gate".padEnd(w)}   runs  failed  last fail    ledger  verdict`);
for (const s of all) {
  const rows = s.ledgerRows.length ? String(s.ledgerRows.length).padStart(6) : "     —";
  console.log(
    `  ${s.gate.padEnd(w)} ${String(s.runs).padStart(6)} ${String(s.failed + s.broken).padStart(7)}` +
    `  ${day(s.lastFailure).padEnd(12)}${rows}  ${s.verdict}`,
  );
}

console.log("");
for (const v of ["quiet", "unobserved", "not-asked", "gone", "too-early"]) {
  const list = all.filter((s) => s.verdict === v);
  if (list.length === 0) continue;
  console.log(`  ${bold}${v}${off} ${dim}— ${WHY[v]}${off}`);
  for (const s of list) console.log(`    ${s.gate} ${dim}(${s.runs} run(s))${off}`);
  console.log("");
}

console.log(`  ${bold}what the ${ledgerRows.length} recorded failures were${off}`);
console.log(`    the harness itself   ${String(origin.harness).padStart(3)}`);
console.log(`    the application      ${String(origin.application).padStart(3)}`);
if (origin.noNamedGate > 0) {
  console.log("");
  console.log(`  ${origin.noNamedGate} of those name a check no gate in gates.sh runs ${dim}(rows ${unattributed.map((r) => r.row).join(", ")})${off}`);
  console.log(`  ${dim}— a hook, a runner, or a helper. Counted above by where the check lives.${off}`);
}
console.log("");
console.log(`  ${dim}A harness mostly catching its own failures is paying off its own${off}`);
console.log(`  ${dim}construction, which is a one-time cost. A harness catching the${off}`);
console.log(`  ${dim}application's is the part that keeps returning. That split is the${off}`);
console.log(`  ${dim}number to watch when pointing this at a real codebase.${off}`);
console.log("");
console.log(`  ${dim}quiet is not useless: a gate exists so a failure stops happening,${off}`);
console.log(`  ${dim}and success looks exactly like silence. Move a quiet gate to a${off}`);
console.log(`  ${dim}slower tier before deleting it, and let the ledger row decide.${off}`);
