// Stop hook body: run the fast gates and hand the next turn a work order.
//
// This is the step that was still manual. Everything else in this harness is
// executed by something -- hooks fire, CI runs, gates exist -- and then it fell
// to whoever was driving to remember to run them, read fourteen results and
// decide where to start. A session that forgets ends a turn believing green
// while the tree is red, and the next thing that notices is CI, twenty minutes
// and a push later.
//
// So the harness asks on every stop, and the answer reaches the next turn's
// reasoning through `hookSpecificOutput.additionalContext` -- the exit-0
// channel. Not exit 2: blocking a stop to be heard is ledger row 8, and it cost
// a tool call every turn.
//
// Four things constrain this hard, and all four are ledger rows:
//
//   row 25  A hook that dirties a tracked file every turn starts a loop: the
//           commit runs CI, CI notifies, the notification wakes a turn, the
//           turn writes another line. So this writes NOTHING tracked. The
//           gates run with --json, which does not fold the staged logs.
//   row 11  A Stop hook that speaks every stop could, if something went wrong,
//           spend a quota unattended. Six stops inside a minute and it goes
//           quiet, exactly as log-usage.sh does.
//   row 8   Exit 0 with additionalContext, never exit 2.
//   row 32  A verdict about a tree that has since changed is worse than no
//           verdict, so the fingerprint of what was checked is stored with the
//           result and a stale one is discarded rather than reported.
//
// And one rule that is not a row: **it never says green when it only asked
// four questions of fourteen.** The fast tier is what fits in a couple of
// seconds; the line says what it did not ask.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const REPO = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const STATE = process.env.GATE_STOP_STATE || path.join(REPO, "audit_log", ".gate-stop.json");

// `--where` prints the path this hook writes to and exits. It exists so
// doctor.sh can ask the hook itself rather than carry a copy of the answer:
// a list of "paths the hooks write" maintained by hand goes stale the moment
// someone adds a hook, and the failure it guards against -- a tracked file
// changing every turn -- is ledger row 25, the loop that ran for an hour at
// about a commit a minute.
if (process.argv.includes("--where")) {
  process.stdout.write(path.relative(REPO, STATE) + "\n");
  process.exit(0);
}

const emit = (text) => {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "Stop",
      additionalContext: text,
    },
  }));
};

const quiet = () => process.exit(0);

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE, "utf8"));
  } catch {
    return { stops: [], lastPrint: "", lastFingerprint: "" };
  }
}

function writeState(state) {
  try {
    fs.mkdirSync(path.dirname(STATE), { recursive: true });
    fs.writeFileSync(STATE, JSON.stringify(state));
  } catch {
    // An unwritable state file must not stop the hook doing its job. It only
    // costs the rate breaker its memory, which fails towards speaking.
  }
}

const state = readState();
const now = Date.now();

// ── the rate breaker ────────────────────────────────────────────────────────
// Five stops inside a minute is faster than a person. Insurance against a loop
// that has never been demonstrated, at a price worth paying because the thing
// it guards against spends a quota with nobody watching.
state.stops = (state.stops ?? []).filter((t) => now - t < 60_000);
state.stops.push(now);
if (state.stops.length > 5) {
  writeState(state);
  emit("[gates] silenced — more than five stops inside a minute. Run `bash scripts/gates.sh` by hand.");
  process.exit(0);
}

// ── has anything changed? ───────────────────────────────────────────────────
// A turn that edited nothing cannot have broken anything, and re-reporting the
// same verdict at every stop is noise that teaches people to skim past it.
// The fingerprint is the working tree plus HEAD, so an edit, a commit, a
// checkout and a stash all count as change.
let fingerprint = "";
try {
  const status = execFileSync("git", ["status", "--porcelain"], { cwd: REPO, encoding: "utf8" });
  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPO, encoding: "utf8" });
  fingerprint = `${head}${status}`;
} catch {
  // Not a git checkout, or git is unavailable. Fall through and check anyway:
  // guessing "nothing changed" from a failed probe is how a guard stops
  // running without anyone noticing.
  fingerprint = String(now);
}

if (fingerprint === state.lastFingerprint) {
  writeState(state);
  quiet();
}

// ── ask ─────────────────────────────────────────────────────────────────────
let order;
try {
  const raw = execFileSync("node", ["scripts/autopilot.mjs", "--fast", "--json"], {
    cwd: REPO,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    // A gate that hangs must not hang the session. The fast tier is seconds;
    // this is the bound at which something has gone wrong rather than slow.
    timeout: 120_000,
    // autopilot exits 1 when there is work, which is not an error here.
    stdio: ["ignore", "pipe", "pipe"],
  });
  order = JSON.parse(raw);
} catch (e) {
  // exit 1 still carries the report on stdout; only a real failure has none.
  try {
    order = JSON.parse(e.stdout ?? "");
  } catch {
    state.lastFingerprint = fingerprint;
    writeState(state);
    // Say it. A gate runner that cannot run is a thing to know about, and
    // silence here is indistinguishable from a clean tree.
    emit("[gates] could not run the fast gates at this stop — `bash scripts/gates.sh --fast` to see why. This is not a pass.");
    process.exit(0);
  }
}

// ── say it ──────────────────────────────────────────────────────────────────
const lines = [];
if (order.work.length === 0) {
  lines.push(`[gates] ${order.ran} fast gates pass.`);
} else {
  lines.push(`[gates] ${order.work.length} failing — fix in this order:`);
  order.work.forEach((w, i) => {
    lines.push(`  ${i + 1}. ${w.gate}: ${w.means}`);
    const first = (w.evidence ?? [])[0];
    if (first) lines.push(`     ${first.trim().slice(0, 160)}`);
    lines.push(`     → ${w.next}`);
  });
}
if (order.notRun?.length) {
  // Never "green" on a subset. The four fast gates passing says nothing about
  // the browser, the mutants, or whether the ledger is still honest.
  lines.push(`  not asked at this stop: ${order.notRun.join(", ")} — \`bash scripts/gates.sh\` before pushing.`);
}

const text = lines.join("\n");

state.lastFingerprint = fingerprint;
// Repeating an identical verdict adds nothing, and the fingerprint check above
// already covers the common case. This catches the rest: two different trees
// with the same verdict.
const repeat = text === state.lastPrint;
state.lastPrint = text;
writeState(state);

if (repeat && order.work.length === 0) quiet();
emit(text);
