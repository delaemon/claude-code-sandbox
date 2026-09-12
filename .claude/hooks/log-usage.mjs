// Body of the Stop hook. Kept in its own file rather than inside `node -e` in
// the shell script, because that is where three separate breakages came from:
// an apostrophe in a comment closes the shell's single-quoted string and the
// hook stops being valid JavaScript. A Stop hook that fails is non-blocking, so
// it then does nothing, quietly — the exact shape this repository refuses. A
// file cannot have that bug, and `node --check` can verify it.
import fs from "node:fs";

const LOG = process.env.USAGE_LOG || "audit_log/usage.md";

const HEADER = [
  "# Session token usage",
  "",
  "Maintained by `.claude/hooks/log-usage.sh`, a Stop hook, so it keeps being",
  "written after the session that added it ends. One row per session, updated",
  "in place.",
  "",
  "`tokens` is output + cache writes + fresh input, the same definition",
  "`audit_log/export.py` uses for the run index. Cache reads are excluded on",
  "purpose: each request re-reads the whole context, so counting them reports",
  "the context size multiplied by the number of turns rather than the work.",
  "",
  "A session with no usage records is absent rather than zero.",
  "",
  "Figures are rounded to 500,000, so this file changes roughly once in fifty",
  "turns rather than on every one. Writing it exactly made it permanently dirty",
  "in git and bought nothing: an uncommitted row dies with the VM just as a",
  "missing one does. The granularity comes from a measured burn rate of",
  "3,000-32,000 tokens a turn. Run `bash scripts/usage.sh --line` for exact",
  "live numbers.",
  "",
  "| session | requests | tokens | updated |",
  "|---|---|---|---|",
];

let raw = "";
process.stdin.on("data", (d) => (raw += d)).on("end", () => {
  let event = {};
  try { event = JSON.parse(raw); } catch { /* malformed: nothing to record */ }

  const path = event.transcript_path;
  const session = String(event.session_id || "").slice(0, 8) || "unknown";
  if (!path || !fs.existsSync(path)) return;

  let out = 0, cacheWrite = 0, fresh = 0, calls = 0, ctx = 0;
  for (const line of fs.readFileSync(path, "utf8").split("\n")) {
    if (!line) continue;
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    const u = entry?.message?.usage;
    if (!u || typeof u.output_tokens !== "number") continue;
    calls += 1;
    out        += u.output_tokens               || 0;
    cacheWrite += u.cache_creation_input_tokens || 0;
    fresh      += u.input_tokens                || 0;
    ctx = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0)
        + (u.cache_read_input_tokens || 0);
  }

  // No measurement is not a measurement of zero. Leave the file untouched.
  if (calls === 0) return;

  const tokens = out + cacheWrite + fresh;
  const n = (x) => x.toLocaleString("en-US");
  const round = (x, to) => Math.round(x / to) * to;
  const day = new Date().toISOString().slice(0, 10);
  const row = `| \`${session}\` | ~${n(round(calls, 500))} `
            + `| ~${n(round(tokens, 500000))} | ${day} |`;

  // Sorted. The rebuild used to drop this session's row and append it, so a row
  // belonging to any other session shifted the order and the file changed with
  // no value changing at all — silently undoing the rounding.
  let body = [];
  try {
    body = fs.readFileSync(LOG, "utf8").split("\n")
             .filter((l) => l.startsWith("| `") && !l.startsWith(`| \`${session}\` |`));
  } catch { /* first write */ }
  body.push(row);
  body.sort();

  const next = HEADER.concat(body).join("\n") + "\n";
  let changed = true;
  try { changed = fs.readFileSync(LOG, "utf8") !== next; } catch { changed = true; }
  if (changed) { try { fs.writeFileSync(LOG, next); } catch { /* read-only */ } }

  // additionalContext only when the row actually moved.
  //
  // Emitting on every stop produced two consecutive turns with no user input,
  // which is the shape of a loop: the hook speaks, that starts a turn, the turn
  // stops, the hook speaks again. Never proven — but an unbounded loop spends
  // quota with nothing to show, so it is bounded rather than investigated while
  // running. Tied to the rounded row, this fires at most once per threshold
  // crossing, so even if the suspicion is right the loop cannot run twice.
  // stop_hook_active, the documented guard for a Stop hook re-entering, is
  // honoured too.
  if (changed && event.stop_hook_active !== true) {
    const line = `[tok] req ${n(calls)} · out+write ${n(tokens)} `
               + `· ctx ${n(ctx)} · remaining: unmeasurable`;
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: { hookEventName: "Stop", additionalContext: line },
    }));
  }
});
