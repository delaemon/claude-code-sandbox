// Move staged per-turn usage into the tracked log.
//
// The hook writes to audit_log/.turns-pending.jsonl, which git ignores, so a
// turn that does nothing else leaves the working tree clean and starts no
// cycle. This folds those lines into audit_log/turns.jsonl, and gates.sh calls
// it -- so they land in the same commit as whatever work the gates were run
// for.
//
// Nothing is lost if it never runs: the pending file keeps appending. It is
// lost if the VM is reclaimed first, which is true of any uncommitted work
// here and is why this runs at every gate rather than at session end.
//
// Usage:  node scripts/fold-turns.mjs
// Exit 0 whether or not there was anything to fold; 1 only on a write failure,
// because a fold that could not happen must not read as a fold that did.
import fs from "node:fs";
import path from "node:path";

const repo = path.resolve(path.dirname(process.argv[1]), "..");
const pending = process.env.TURNS_PENDING
  || path.join(repo, "audit_log/.turns-pending.jsonl");
const tracked = process.env.TURNS_LOG || path.join(repo, "audit_log/turns.jsonl");

let lines;
try {
  lines = fs.readFileSync(pending, "utf8").split("\n").filter((l) => l.trim());
} catch {
  console.log("no staged turns");
  process.exit(0);
}
if (lines.length === 0) {
  console.log("no staged turns");
  process.exit(0);
}

try {
  fs.mkdirSync(path.dirname(tracked), { recursive: true });
  fs.appendFileSync(tracked, lines.join("\n") + "\n");
  // Only clear the staging file once the append has landed.
  fs.writeFileSync(pending, "");
} catch (e) {
  console.error(`Could not fold staged turns: ${e.message}`);
  console.error("Leaving them staged rather than reporting a fold that did not happen.");
  process.exit(1);
}
console.log(`folded ${lines.length} turn${lines.length === 1 ? "" : "s"} into ${path.relative(repo, tracked)}`);
