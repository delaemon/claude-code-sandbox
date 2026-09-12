#!/usr/bin/env bash
# Stop hook: record what this session has spent, into audit_log/usage.md.
#
# The rule this enforces is "token usage is written alongside the logs", and it
# is a hook rather than a line in CLAUDE.md for the reason CLAUDE.md itself
# gives: that file is advisory and can be missed, a hook is executed by the
# harness. It therefore keeps holding after the session that added it ends, in
# any session that checks out this branch.
#
# It writes rather than nags. A Stop hook that exited 2 to demand the agent add
# a line could refuse to let a session finish, which is a far worse failure than
# a missing row — so this one never blocks: it exits 0 on every path.
#
# What it will not do is invent a row. If the transcript cannot be read or holds
# no usage records, the file is left exactly as it was; a session that was not
# measured must not appear as a session that cost nothing. Visibility for that
# case comes from scripts/doctor.sh, which runs this hook and checks it.
#
# The figures are ROUNDED, and that is the point rather than sloppiness. The
# first version wrote exact counts and a minute-precision timestamp, so the file
# changed on every single stop — a tracked file permanently dirty, and a
# "commit your changes" warning on every turn. Writing it precisely bought no
# durability either: an uncommitted row dies with the VM exactly like no row at
# all. Rounded, the file changes a handful of times per session, each change
# meaning the session crossed a real threshold. `scripts/usage.sh --line` is
# where exact live numbers come from.
#
# The granularity is set from a measured burn rate, not guessed: this session
# ran 3,000-32,000 tokens a turn, averaging ~10,000. A first attempt rounded
# output to 10,000, which output crosses every two or three turns, so the file
# still churned and the warning came back. At 500,000 a typical turn moves the
# file once in ~50 turns and the worst observed turn once in ~15. The separate
# output column is gone: it tracked the same work at a tenth of the scale, so it
# set the churn rate no matter what the token column did.
#
# node, not python3: the cloud image has python3 and a dev container need not.
set -uo pipefail

payload=$(cat 2>/dev/null || true)
cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}" 2>/dev/null || exit 0
[ -d audit_log ] || exit 0

command -v node >/dev/null 2>&1 || exit 0

printf '%s' "$payload" | node -e '
const fs = require("fs");
let raw = ""; process.stdin.on("data", (d) => (raw += d)).on("end", () => {
  let j = {}; try { j = JSON.parse(raw); } catch {}
  const path = j.transcript_path;
  const session = String(j.session_id || "").slice(0, 8) || "unknown";
  if (!path || !fs.existsSync(path)) process.exit(0);

  let out = 0, cw = 0, fresh = 0, calls = 0, ctx = 0;
  for (const line of fs.readFileSync(path, "utf8").split("\n")) {
    if (!line) continue;
    let e; try { e = JSON.parse(line); } catch { continue; }
    const u = e?.message?.usage;
    if (!u || typeof u.output_tokens !== "number") continue;
    calls++;
    out   += u.output_tokens               || 0;
    cw    += u.cache_creation_input_tokens  || 0;
    fresh += u.input_tokens                 || 0;
    ctx = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0)
        + (u.cache_read_input_tokens || 0);
  }
  // No measurement is not a measurement of zero. Leave the file untouched.
  if (calls === 0) process.exit(0);

  // Same definition as audit_log/export.py: output, cache writes and fresh
  // input. Cache reads are excluded — every request re-reads the whole
  // context, so including them reports the context size times the turn count.
  const tokens = out + cw + fresh;
  const n = (x) => x.toLocaleString("en-US");
  // Rounded so the file does not change on every stop. See the note above.
  const round = (x, to) => Math.round(x / to) * to;
  const day = new Date().toISOString().slice(0, 10);
  const row = `| \x60${session}\x60 | ~${n(round(calls, 500))} | `
            + `~${n(round(tokens, 500000))} | ${day} |`;

  // Exit 0 is not a silent channel. The documented structured output for a Stop
  // hook is JSON on stdout, and additionalContext reaches the reasoning of the
  // next turn. CLAUDE.md here claimed the opposite -- that exit 0 can say
  // nothing, which is why typecheck.sh reaches for exit 2 -- and that claim
  // cost one tool call per turn to report usage the harness now carries free.
  // No apostrophes in this block: it lives inside node -e with single quotes.
  const file = "audit_log/usage.md";
  const header = [
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

  let body = [];
  try {
    const cur = fs.readFileSync(file, "utf8").split("\n");
    body = cur.filter((l) => l.startsWith("| `") && !l.startsWith(`| \x60${session}\x60 |`));
  } catch {}
  body.push(row);
  let changed = true;
  try { changed = fs.readFileSync(file, "utf8") !== header.concat(body).join("\n") + "\n"; }
  catch { changed = true; }
  try {
    if (changed) fs.writeFileSync(file, header.concat(body).join("\n") + "\n");
  } catch {}

  // additionalContext only when the row actually moved.
  //
  // Emitting it every stop produced two consecutive turns with no user input,
  // which is the shape of a loop: the hook speaks, that starts a turn, the turn
  // stops, the hook speaks again. That was not proven -- but an unbounded loop
  // spends someone--s quota with nothing to show, so it is bounded rather than
  // investigated while running. Tied to the rounded row, this can fire at most
  // once per threshold crossing, roughly once in fifty turns, so even if the
  // suspicion is right the loop cannot run twice.
  //
  // stop_hook_active is the documented guard for a Stop hook re-entering, and
  // is honoured too: when the harness says it is already continuing because of
  // a stop hook, this one says nothing at all.
  if (changed && j.stop_hook_active !== true) {
    const line = `[tok] req ${n(calls)} \u00b7 out+write ${n(tokens)} \u00b7 `
               + `ctx ${n(ctx)} \u00b7 remaining: unmeasurable`;
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: { hookEventName: "Stop", additionalContext: line },
    }));
  }
});
'

exit 0
