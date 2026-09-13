// Does CI run every gate `gates.sh` runs?
//
// `gates.sh` is what a person runs before pushing. CI is what runs when they
// forget, and on every pull request. They are supposed to ask the same
// questions — but they are two separate lists, maintained by hand, and a gate
// added to one and not the other produces no error anywhere. The gate still
// passes locally; CI simply never asks.
//
// That is not hypothetical. Two gates were found missing a CI step:
//
//   audit log tests   177 lines of assertions that ran in neither place, since
//                     the local gate also swallowed its own failure (row 47)
//   usage churn       a check on whether the usage log has started dirtying
//                     the tree every turn — the loop of ledger row 25
//
// Matched on the **command**, not the step name. A name is a label someone
// chose; the command is what actually runs, and asking "does CI run this
// program" is the question that matters. It also means renaming a CI step
// never breaks this, and deleting the step it named always does.
//
// Exit 0 when CI runs every gate, 1 when it does not, 2 when it could not look.
import fs from "node:fs";
import path from "node:path";
import { REPO } from "./config.mjs";

const GATES = path.join(REPO, "scripts/gates.sh");
const WORKFLOW = path.join(REPO, ".github/workflows/ci.yml");

const read = (file, what) => {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    console.error(`No ${what} at ${path.relative(REPO, file)}.`);
    console.error("A missing half of the comparison is a broken setup, not a pass.");
    process.exit(2);
  }
};

const gatesText = read(GATES, "gate runner");
const ciText = read(WORKFLOW, "workflow");

// ── what gates.sh runs ──────────────────────────────────────────────────────
//
// `run "<label>" <command...>`, with comment lines stripped so the commentary
// above a gate is not mistaken for one. The commands are literal here by
// design: nothing in gates.sh interpolates a gate command except the app-gate
// plumbing below.
const gates = [];
for (const line of gatesText.split("\n")) {
  if (/^\s*#/.test(line)) continue;
  const m = line.match(/^\s*run\s+"([^"]+)"\s+(.+?)\s*$/);
  if (!m) continue;
  const [, label, command] = m;
  // The app-gate helper calls `run` with a synthesised shell command carrying
  // the captured output. Application gates reach CI through
  // `${{ steps.cfg.outputs.app_* }}` steps instead -- a different mechanism,
  // driven by harness.config.json, and not something to match textually.
  if (command.startsWith("bash -c \"printf")) continue;
  gates.push({ label, command });
}

if (gates.length === 0) {
  console.error("Found no gates in scripts/gates.sh. Refusing to report agreement");
  console.error("between a list of gates and a workflow when one list is empty.");
  process.exit(2);
}

// ── what CI runs ────────────────────────────────────────────────────────────
//
// Every `run:` body, single-line and block form alike, concatenated. This is a
// containment test, not a parse: a command that appears anywhere in a step's
// script is a command CI runs.
const ciRuns = [];
const ciLines = ciText.split("\n");
for (let i = 0; i < ciLines.length; i++) {
  const single = ciLines[i].match(/^\s*run:\s*(\S.*)$/);
  if (single && !/^[|>]/.test(single[1].trim())) {
    ciRuns.push(single[1]);
    continue;
  }
  if (!/^\s*run:\s*[|>]/.test(ciLines[i])) continue;
  const indent = (ciLines[i].match(/^\s*/) || [""])[0].length;
  for (let j = i + 1; j < ciLines.length; j++) {
    const body = ciLines[j];
    if (body.trim() === "") { ciRuns.push(""); continue; }
    if ((body.match(/^\s*/) || [""])[0].length <= indent) break;
    ciRuns.push(body);
  }
}
const ciScript = ciRuns.join("\n");

if (ciScript.trim() === "") {
  console.error("The workflow has no `run:` steps this could read.");
  console.error("Refusing to report that CI runs every gate.");
  process.exit(2);
}

// ── compare ─────────────────────────────────────────────────────────────────
const missing = gates.filter((g) => !ciScript.includes(g.command));

for (const g of gates) {
  if (!missing.includes(g)) console.log(`  ok    ${g.label} — CI runs \`${g.command}\``);
}

if (missing.length > 0) {
  console.error("");
  console.error("These gates run before a push and never run in CI:");
  for (const g of missing) console.error(`  - ${g.label}: \`${g.command}\``);
  console.error("");
  console.error("Nothing errors when the two lists drift: the gate still passes");
  console.error("locally, and CI simply never asks. Add a step to");
  console.error(".github/workflows/ci.yml, or say in that file why this one is");
  console.error("deliberately local-only.");
  process.exit(1);
}

console.log("");
console.log(`CI runs all ${gates.length} gates`);
