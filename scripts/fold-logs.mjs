// Move staged hook output into the tracked logs.
//
// Every hook here used to write straight into a tracked file, and a tracked
// file that changes every time a hook fires has no quiet state: committing it
// runs CI, whose completion notifies, which wakes a turn, which fires the hook
// again; not committing it makes the environment ask for a commit, which also
// wakes a turn. Both are loops.
//
// So the hooks write beside the real logs, to paths git ignores, and this folds
// them in. gates.sh calls it, and gates run before every real commit here, so
// the lines land with the work rather than alone.
//
// All three staged paths are handled together. The first version of this
// covered only the per-turn log, and audit_log/subagents.jsonl kept dirtying
// the tree on its own -- one of two writers fixed, which reads as fixed until
// the other one fires.
//
// Usage:  node scripts/fold-logs.mjs
// Exit 0 whether or not there was anything to fold; 1 on a write failure,
// because a fold that could not happen must not read as a fold that did.
import fs from "node:fs";
import path from "node:path";

const repo = path.resolve(path.dirname(process.argv[1]), "..");
const dir = process.env.AUDIT_DIR || path.join(repo, "audit_log");

// `append` adds lines; `replace` overwrites, for the rounded summary which is
// rewritten rather than extended.
const STAGED = [
  { from: ".turns-pending.jsonl", to: "turns.jsonl", mode: "append" },
  { from: ".subagents-pending.jsonl", to: "subagents.jsonl", mode: "append" },
  { from: ".usage-pending.md", to: "usage.md", mode: "replace" },
];

let folded = 0, failed = false;
for (const item of STAGED) {
  const from = path.join(dir, item.from);
  const to = path.join(dir, item.to);
  let body;
  try { body = fs.readFileSync(from, "utf8"); } catch { continue; }
  if (body.trim() === "") continue;

  try {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    if (item.mode === "append") {
      const lines = body.split("\n").filter((l) => l.trim());
      fs.appendFileSync(to, lines.join("\n") + "\n");
      folded += lines.length;
    } else {
      fs.writeFileSync(to, body);
      folded += 1;
    }
    // Clear the staging file only once the write has landed.
    fs.writeFileSync(from, "");
  } catch (e) {
    console.error(`Could not fold ${item.from}: ${e.message}`);
    console.error("Leaving it staged rather than reporting a fold that did not happen.");
    failed = true;
  }
}

if (failed) process.exit(1);
console.log(folded === 0 ? "nothing staged" : `folded ${folded} staged record(s)`);
