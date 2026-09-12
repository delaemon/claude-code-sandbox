#!/usr/bin/env bash
# What this session has actually spent, measured rather than estimated.
#
# Claude Code writes every request's token usage into the session transcript.
# This reads that file and adds it up. Nothing here is a guess.
#
# What it deliberately does NOT report is "how much is left". The transcript
# records rate-limit state only on a *rejection* — `status:"rejected"` with a
# `resetsAt` — and never while requests are still being served. There is no
# remaining-quota signal to read, so this prints none. A gauge that cannot
# measure must not look like a gauge reading a comfortable number; that is the
# same rule the hooks here follow.
#
# Usage:  bash scripts/usage.sh [TRANSCRIPT.jsonl]
#         bash scripts/usage.sh --line   one compact line, with the delta since
#                                        the previous --line call
#
# --line keeps a stamp under the scratch directory so the delta survives across
# calls. If the stamp is missing the delta is reported as "first", never as 0.
set -uo pipefail

mode="full"
if [ "${1:-}" = "--line" ]; then mode="line"; shift; fi

transcript="${1:-}"
if [ -z "$transcript" ]; then
  dir="${CLAUDE_PROJECT_DIR:-$HOME/.claude/projects}"
  # Newest transcript under any project directory.
  transcript=$(find "$dir" -name '*.jsonl' -type f -printf '%T@ %p\n' 2>/dev/null \
               | sort -rn | head -1 | cut -d' ' -f2-)
fi

if [ -z "$transcript" ] || [ ! -r "$transcript" ]; then
  echo "No readable transcript found." >&2
  echo "Pass one explicitly: bash scripts/usage.sh path/to/session.jsonl" >&2
  exit 1
fi

node -e '
const fs = require("fs"), rl = require("readline");
const path = process.argv[1];
const r = rl.createInterface({ input: fs.createReadStream(path) });

let out = 0, think = 0, cacheWrite = 0, cacheRead = 0, fresh = 0, calls = 0;
let lastContext = 0, limit = null;

r.on("line", (line) => {
  let j; try { j = JSON.parse(line); } catch { return; }
  const u = j?.message?.usage;
  if (u && typeof u.output_tokens === "number") {
    calls++;
    out        += u.output_tokens               || 0;
    think      += u.output_tokens_details?.thinking_tokens || 0;
    cacheWrite += u.cache_creation_input_tokens || 0;
    cacheRead  += u.cache_read_input_tokens     || 0;
    fresh      += u.input_tokens                || 0;
    lastContext = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0)
                + (u.cache_read_input_tokens || 0);
  }
  // Rate limits appear only when a request was refused.
  const s = JSON.stringify(j);
  if (j?.isApiErrorMessage && s.includes("\"rateLimitType\"")) {
    const at = s.match(/"resetsAt":(\d+)/);
    const ty = s.match(/"rateLimitType":"([a-z_]+)"/);
    if (at) limit = { resetsAt: Number(at[1]), type: ty ? ty[1] : "unknown" };
  }
});

r.on("close", () => {
  if (calls === 0) {
    console.error("Transcript has no usage records; refusing to report zero as a total.");
    process.exit(1);
  }
  const n = (x) => x.toLocaleString("en-US");
  const mode = process.argv[2] || "full";
  const stampPath = process.argv[3];

  if (mode === "line") {
    // Delta since the previous --line call. A missing stamp is reported as
    // "first", not as a delta of zero: no reading and no change must not look
    // the same.
    let prev = null;
    try { prev = JSON.parse(fs.readFileSync(stampPath, "utf8")); } catch {}
    const billed = out + cacheWrite + fresh;
    const d = prev && typeof prev.billed === "number"
      ? `+${n(billed - prev.billed)}` : "first";
    const dCalls = prev && typeof prev.calls === "number"
      ? `+${calls - prev.calls}` : "first";
    try {
      fs.writeFileSync(stampPath, JSON.stringify({ billed, calls, at: Date.now() }));
    } catch (e) {
      console.log(`[tok] stamp unwritable (${e.code}); delta unavailable`);
    }
    const parts = [
      `req ${n(calls)} (${dCalls})`,
      `out+write ${n(billed)} (${d})`,
      `ctx ${n(lastContext)}`,
    ];
    if (limit) {
      const mins = Math.round((limit.resetsAt * 1000 - Date.now()) / 60000);
      parts.push(mins > 0
        ? `${limit.type} reset in ${mins}m`
        : `last ${limit.type} block ${-mins}m ago`);
    }
    parts.push("remaining: unmeasurable");
    console.log("[tok] " + parts.join(" · "));
    return;
  }

  console.log(`transcript   ${path}`);
  console.log(`requests     ${n(calls)}`);
  console.log("");
  console.log(`output       ${n(out)}  (thinking ${n(think)})`);
  console.log(`cache write  ${n(cacheWrite)}`);
  console.log(`cache read   ${n(cacheRead)}`);
  console.log(`fresh input  ${n(fresh)}`);
  console.log(`context now  ${n(lastContext)}  (last request)`);
  console.log("");
  if (limit) {
    const d = new Date(limit.resetsAt * 1000);
    const mins = Math.round((d - Date.now()) / 60000);
    const when = mins > 0 ? `in ${mins} min` : `${-mins} min ago`;
    console.log(`last refusal ${limit.type}, reset ${d.toISOString()} (${when})`);
  } else {
    console.log("last refusal none recorded");
  }
  console.log("remaining    not measurable — the transcript records the limit");
  console.log("             only when a request is refused, never before.");
});
' "$transcript" "$mode" "${STAMP:-${TMPDIR:-/tmp}/claude-usage-stamp.json}"
