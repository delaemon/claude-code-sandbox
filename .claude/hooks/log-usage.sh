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
  const now = new Date().toISOString().replace(/:\d\d\.\d+Z$/, "Z");
  const row = `| \x60${session}\x60 | ${n(calls)} | ${n(tokens)} | ${n(out)} | ${n(ctx)} | ${now} |`;

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
    "| session | requests | tokens | output | context | updated |",
    "|---|---|---|---|---|---|",
  ];

  let body = [];
  try {
    const cur = fs.readFileSync(file, "utf8").split("\n");
    body = cur.filter((l) => l.startsWith("| `") && !l.startsWith(`| \x60${session}\x60 |`));
  } catch {}
  body.push(row);
  try {
    fs.writeFileSync(file, header.concat(body).join("\n") + "\n");
  } catch {}
});
' 2>/dev/null

exit 0
