// Turn a failure into a ledger row and an eval case, and refuse to keep either
// unless the check is seen to catch it.
//
// The loop this repository runs on is: something went wrong, write the check
// that would have caught it, prove the check bites, record both. Every step of
// that was executed by something except the last two, which were a person
// editing a markdown table and a shell file by hand. So:
//
//   - `docs/LEDGER.md`'s "verified by breaking" column was a claim. Row 18 is
//     that observation, and `evals/run.sh` is what made it re-checkable. But
//     re-checking a claim only helps if the claim was true when written, and
//     nothing checked that.
//   - A row could be added with no case at all, and would sit there reading as
//     closed. `ledger.sh` only asks whether the named check *exists*, not
//     whether it catches anything.
//
// This closes both. It writes the case and the row, runs the case, and if the
// break does not make the check fail it **removes what it just wrote** and says
// why. A row that reaches the table has been earned by execution.
//
// Usage:
//   node scripts/learn.mjs --name <slug> --failure <text> --check <cmd>
//                          --break <shell> [--setup <shell>] [--catcher <ref>]
//                          [--dry-run]
//
//   --name     the case file name, evals/cases/<name>.sh
//   --failure  the row's text: state it as a BEHAVIOUR, not as a diff. "The
//              guard exited 0 when node was absent", not "the script was wrong"
//   --check    the command that must pass before the break and fail after it
//   --break    shell that damages a throwaway copy of the repository
//   --setup    optional shell that arranges what the check needs first
//   --catcher  what goes in the ledger's check column -- a path, or the literal
//              text of an assertion label. Defaults to the first path in --check
//
//   --next     print the next free row number and exit
//   --dry-run  show what would be written, write nothing, verify nothing
//
// Exit 0 when the row is earned, 1 when the case did not catch and nothing was
// kept, 2 when it could not run.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { REPO } from "./config.mjs";

const LEDGER = path.join(REPO, "docs/LEDGER.md");
const CASES = path.join(REPO, "evals/cases");

// ── arguments ───────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return null;
  const v = argv[i + 1];
  // `--check` with nothing after it silently meaning "no check" is the shape of
  // ledger row 21: a flag whose empty value selected everything.
  if (v === undefined || v.startsWith("--")) {
    console.error(`--${name} needs a value.`);
    process.exit(2);
  }
  return v;
};
const has = (name) => argv.includes(`--${name}`);

function nextRow() {
  const text = fs.readFileSync(LEDGER, "utf8");
  const numbers = [...text.matchAll(/^\|\s*(\d+)\s*\|/gm)].map((m) => Number(m[1]));
  if (numbers.length === 0) {
    console.error("docs/LEDGER.md has no numbered rows. Refusing to guess where to start.");
    process.exit(2);
  }
  return Math.max(...numbers) + 1;
}

if (has("next")) {
  console.log(String(nextRow()));
  process.exit(0);
}

const name = flag("name");
const failure = flag("failure");
const check = flag("check");
const breakage = flag("break");
const setup = flag("setup");
const dryRun = has("dry-run");

for (const [label, value] of [["name", name], ["failure", failure], ["check", check], ["break", breakage]]) {
  if (!value) {
    console.error(`--${label} is required. See the header of this file.`);
    process.exit(2);
  }
}
if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) {
  console.error(`--name must be a lowercase slug; got "${name}".`);
  process.exit(2);
}

// The eval runner refuses a CHECK that re-enters it, and so does this: a case
// whose check runs the suite that runs the case proves nothing and takes a
// while to say so.
if (/evals\/run\.sh|gates\.sh/.test(check)) {
  console.error("--check would re-enter the eval suite. Name the underlying check instead.");
  process.exit(2);
}

const catcher = flag("catcher") ?? (check.match(/\b[\w./-]+\.(sh|mjs|py)\b/)?.[0] ?? null);
if (!catcher) {
  console.error("Could not work out what to put in the ledger's check column.");
  console.error("Pass --catcher with a path, or with the assertion label's literal text.");
  process.exit(2);
}

const casePath = path.join(CASES, `${name}.sh`);
if (fs.existsSync(casePath) && !dryRun) {
  console.error(`evals/cases/${name}.sh already exists. Pick another --name, or edit that one.`);
  process.exit(2);
}

const row = nextRow();
const escapedFailure = failure.replace(/\|/g, "\\|");
const rowText = `| ${row} | ${escapedFailure} | \`${catcher}\` | yes |\n`;

const caseText = `# ${failure}
#
# Written by scripts/learn.mjs, which ran this case before the row was kept:
# the check had to pass against an unbroken copy and fail against a broken one.
# A row whose case does not catch is not written at all.
LEDGER_ROW=${row}
CHECK='${check.replace(/'/g, "'\\''")}'
${setup ? `setup() {\n  ${setup}\n}\n` : ""}break_it() {
  ${breakage}
}
`;

if (dryRun) {
  console.log(`would append to docs/LEDGER.md:\n${rowText}`);
  console.log(`would write evals/cases/${name}.sh:\n${caseText}`);
  process.exit(0);
}

// ── write, verify, and keep only if earned ──────────────────────────────────
const ledgerBefore = fs.readFileSync(LEDGER, "utf8");

// The row goes after the last numbered row, which is where the table ends.
const rows = [...ledgerBefore.matchAll(/^\|\s*\d+\s*\|.*$/gm)];
const last = rows[rows.length - 1];
const at = last.index + last[0].length;
fs.writeFileSync(LEDGER, ledgerBefore.slice(0, at) + "\n" + rowText.trimEnd() + ledgerBefore.slice(at));
fs.writeFileSync(casePath, caseText);

const rollback = (why, detail) => {
  fs.writeFileSync(LEDGER, ledgerBefore);
  try { fs.unlinkSync(casePath); } catch {}
  console.error("");
  console.error(`Not learned: ${why}`);
  if (detail) console.error(detail);
  console.error("");
  console.error("The row and the case have been removed. Nothing was kept, because");
  console.error("a ledger row whose check has not been seen to catch its failure is");
  console.error("prose with a tick beside it.");
};

console.log(`row ${row}, case evals/cases/${name}.sh — replaying it`);
const run = spawnSync("bash", ["evals/run.sh", name], {
  cwd: REPO,
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
  timeout: 15 * 60_000,
});

if (run.error || run.status === null) {
  rollback("the eval suite could not run the case", run.error?.message ?? "it was killed, most likely by the timeout");
  process.exit(2);
}

const out = (run.stdout ?? "").replace(/\[[0-9;]*m/g, "");
process.stdout.write(out);
if (run.stderr) process.stderr.write(run.stderr);

// "1 replayed, 1 still caught, 0 NOT caught" is the only acceptable answer. A
// zero-case run reports its own failure, and the runner exits non-zero for
// every other outcome -- but the count is checked too rather than trusting an
// exit code to have meant what this expects.
const caught = /(\d+) replayed, (\d+) still caught, (\d+) NOT caught/.exec(out);
if (!caught) {
  rollback("the eval suite reported nothing this could read", out.split("\n").slice(-6).join("\n"));
  process.exit(2);
}
const [, replayed, stillCaught, notCaught] = caught.map(Number);
if (replayed !== 1 || stillCaught !== 1 || notCaught !== 0 || run.status !== 0) {
  rollback(
    "the break did not make the check fail",
    "Either the break did not land, or the check does not look at what it damaged.\n" +
    "Confirm the break lands before reading the verdict -- this repository has\n" +
    "skipped that step and believed a check was working three separate times.",
  );
  process.exit(1);
}

// The ledger must still be internally consistent afterwards: the check named
// has to exist. Writing a row that ledger.sh then rejects would leave the tree
// red, having just been told the lesson was learned.
const led = spawnSync("bash", ["scripts/ledger.sh"], { cwd: REPO, encoding: "utf8" });
if (led.status !== 0) {
  rollback(
    `the ledger does not accept \`${catcher}\` as a check that exists`,
    (led.stdout ?? "").split("\n").filter((l) => /FAIL/.test(l)).join("\n"),
  );
  process.exit(1);
}

console.log("");
console.log(`learned: row ${row} is in docs/LEDGER.md, and evals/cases/${name}.sh replays it.`);
console.log("Its \"verified by breaking\" was earned by running, not by being typed.");
