// Body of the Stop hook. Kept in its own file rather than inside `node -e` in
// the shell script, because that is where three separate breakages came from:
// an apostrophe in a comment closes the shell's single-quoted string and the
// hook stops being valid JavaScript. A Stop hook that fails is non-blocking, so
// it then does nothing, quietly.
//
// Three outputs, deliberately different in shape:
//
//   audit_log/turns.jsonl  one line per stop, append-only. Appending is why
//                          this can be per-turn at all: the earlier version
//                          rewrote a row in place and re-sorted it, so the file
//                          changed on every stop for reasons unrelated to the
//                          numbers. An append adds one line and touches nothing
//                          else. Numbers only -- no content, ever.
//
//   audit_log/usage.md     the rounded per-session summary, unchanged. It stays
//                          coarse so the durable record is not fifty rows of
//                          the same session.
//
//   additionalContext      the same line, back in the conversation every stop.
//
// On emitting every stop: this was narrowed once, to threshold crossings, after
// two turns arrived with no user input and that looked like a hook talking
// itself into a loop. It was never diagnosed, and narrowing it removed
// something that had been asked for on a suspicion. It is restored, with a rate
// breaker below that targets the runaway directly instead.
import fs from "node:fs";
import path from "node:path";

// Staged like the turn log. This one is rewritten rather than appended, and
// changes only when the rounded row moves -- but "rarely" is not "never", and
// every one of those changes was a loop iteration.
const LOG = process.env.USAGE_LOG || "audit_log/.usage-pending.md";
// Staged outside git, not written straight into the tracked log.
//
// A tracked file that changes every turn has no quiet state: committing it runs
// CI, whose completion notifies, which wakes a turn, which writes another line;
// not committing it makes the environment ask for a commit, which also wakes a
// turn. Both are loops, and six of ten commits on one pull request were the
// first one. scripts/fold-turns.mjs moves these lines into the tracked log when
// there is other work to commit them with -- gates.sh calls it, and gates run
// before every real commit here.
const TURNS = process.env.TURNS_LOG || "audit_log/.turns-pending.jsonl";
const CACHE = process.env.SUBAGENT_CACHE
  || path.join(process.env.TMPDIR || "/tmp", "claude-subagent-tokens.json");

// A loop would produce stops far faster than a person can. Five in a minute is
// already impossible by hand; normal work is one every few minutes at most.
const BREAKER_STOPS = 5;
const BREAKER_WINDOW_MS = 60_000;

/**
 * When to say the context has grown past the point worth carrying.
 *
 * This hook already computes `ctx` every stop and has been printing it as a
 * bare number, which nobody can act on without knowing what large looks like.
 * The threshold turns it into a decision: over this, `/compact`.
 *
 * 400,000 is the default because it is a published, measured figure rather
 * than one invented here -- Uber compacts at 400k even on million-token
 * models, trading a larger window against cache bursts and re-sent input.
 * Their result is a cost one (cost per session roughly halved), and that is
 * the honest claim to make for it. Compacting is NOT a correctness fix: this
 * session measured its own self-corrections against context size and found no
 * monotonic relationship -- 7.5% of turns under 200k against 6.3% over 600k.
 * Compacting harder can even make recall worse, because the facts that get
 * asserted from memory are exactly the ones a summary drops.
 *
 * So this warns; it does not compact, and nothing here decides for you.
 *
 * An unreadable config falls back to warning rather than to silence, the same
 * way block-secrets.sh over-blocks when it cannot parse its input. A threshold
 * that quietly switched itself off would be a guard that looks like it ran.
 * Set `context.compactAt` to 0 to turn it off deliberately, which is a
 * different thing from it failing to load.
 */
const CONTEXT_LIMIT = (() => {
  const repo = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(repo, "harness.config.json"), "utf8"));
    const v = cfg?.context?.compactAt;
    if (v === 0) return 0;
    if (typeof v === "number" && v > 0) return v;
  } catch { /* fall through to the default: warn, do not go quiet */ }
  return 400_000;
})();

const n = (x) => x.toLocaleString("en-US");
const sum = (u) => (u.output_tokens || 0) + (u.cache_creation_input_tokens || 0)
                 + (u.input_tokens || 0);

/** Usage across one transcript. Returns null when it holds no usage records. */
function readUsage(file) {
  let out = 0, tokens = 0, calls = 0, ctx = 0;
  let text;
  try { text = fs.readFileSync(file, "utf8"); } catch { return null; }
  for (const line of text.split("\n")) {
    if (!line) continue;
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    const u = e?.message?.usage;
    if (!u || typeof u.output_tokens !== "number") continue;
    calls += 1;
    out += u.output_tokens || 0;
    tokens += sum(u);
    ctx = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0)
        + (u.cache_read_input_tokens || 0);
  }
  return calls === 0 ? null : { calls, out, tokens, ctx };
}

/**
 * Subagent totals, from the transcripts that exist.
 *
 * Only runs that leave a file can be counted. `agent_transcript_path` from
 * SubagentStop names where a transcript would go, not where one is -- the first
 * recorded value pointed at a file that was never written. So this reports the
 * number of runs it could measure, and the caller says so rather than implying
 * the total covers every subagent.
 *
 * Cached by file size: a finished transcript does not grow, so only new or
 * still-writing files are re-read. The cache lives outside the repository and
 * losing it costs one recompute.
 */
function subagentTotals() {
  const root = path.join(process.env.CLAUDE_CONFIG_DIR
    || path.join(process.env.HOME || "/root", ".claude"), "projects");
  let files = [];
  const walk = (dir, depth) => {
    if (depth > 3) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full, depth + 1);
      else if (/^agent-.*\.jsonl$/.test(e.name) && path.basename(dir) === "subagents") {
        files.push(full);
      }
    }
  };
  walk(root, 0);

  let cache = {};
  try { cache = JSON.parse(fs.readFileSync(CACHE, "utf8")); } catch { /* cold */ }

  let tokens = 0, runs = 0;
  const next = {};
  for (const file of files) {
    let size;
    try { size = fs.statSync(file).size; } catch { continue; }
    const key = `${file}:${size}`;
    let value = cache[key];
    if (value === undefined) {
      const u = readUsage(file);
      value = u ? u.tokens : 0;
    }
    next[key] = value;
    tokens += value;
    runs += 1;
  }
  try { fs.writeFileSync(CACHE, JSON.stringify(next)); } catch { /* best effort */ }
  return { tokens, runs };
}

/** True when stops are arriving faster than a person could produce them. */
function runaway() {
  let lines;
  try { lines = fs.readFileSync(TURNS, "utf8").trim().split("\n"); } catch { return false; }
  const recent = lines.slice(-BREAKER_STOPS);
  if (recent.length < BREAKER_STOPS) return false;
  try {
    const first = Date.parse(JSON.parse(recent[0]).at);
    return Date.now() - first < BREAKER_WINDOW_MS;
  } catch { return false; }
}

let raw = "";
process.stdin.on("data", (d) => (raw += d)).on("end", () => {
  let event = {};
  try { event = JSON.parse(raw); } catch { /* malformed: nothing to record */ }

  const file = event.transcript_path;
  const session = String(event.session_id || "").slice(0, 8) || "unknown";
  if (!file || !fs.existsSync(file)) return;

  const u = readUsage(file);
  // No measurement is not a measurement of zero.
  if (u === null) return;

  const sub = subagentTotals();

  // Delta since the previous turn of this session.
  //
  // Read the staged file first, then the tracked one: folding empties the
  // staging file, so looking only there reported `first` after every real
  // commit -- the delta reset itself exactly when work was being done, which is
  // when it matters most.
  let previous = null;
  const findPrevious = (file) => {
    try {
      const lines = fs.readFileSync(file, "utf8").trim().split("\n");
      for (let i = lines.length - 1; i >= 0; i--) {
        if (!lines[i].trim()) continue;
        const row = JSON.parse(lines[i]);
        if (row.session === session) return row;
      }
    } catch { /* absent or unreadable */ }
    return null;
  };
  previous = findPrevious(TURNS)
    ?? findPrevious(path.join(path.dirname(TURNS), "turns.jsonl"));
  const delta = previous ? u.tokens - previous.tokens : null;

  const overContext = CONTEXT_LIMIT > 0 && u.ctx >= CONTEXT_LIMIT;
  const line = `[tok] turn ${delta === null ? "first" : "+" + n(delta)}`
             + ` · session ${n(u.tokens)} (${n(u.calls)} req)`
             + ` · subagents ${n(sub.tokens)} (${sub.runs} measurable)`
             + ` · ctx ${n(u.ctx)}`
             + (overContext ? ` · OVER ${n(CONTEXT_LIMIT)} — /compact` : "");

  const tripped = runaway();

  // Numbers, and flags derived from them. No content, ever: this file is
  // committed to a public repository.
  try {
    fs.mkdirSync(path.dirname(TURNS), { recursive: true });
    fs.appendFileSync(TURNS, JSON.stringify({
      at: new Date().toISOString(), session,
      requests: u.calls, tokens: u.tokens, output: u.out, context: u.ctx,
      context_limit: CONTEXT_LIMIT, over_context: overContext,
      delta, subagent_tokens: sub.tokens, subagent_runs: sub.runs,
    }) + "\n");
  } catch { /* read-only checkout */ }

  // --- the rounded per-session summary, unchanged ---------------------------
  const round = (x, to) => Math.round(x / to) * to;
  const HEADER = [
    "# Session token usage",
    "",
    "One rounded row per session, by `.claude/hooks/log-usage.sh` on Stop. Rounded",
    "so this file changes a few times a day rather than every turn; `turns.jsonl`",
    "beside it has the per-turn numbers, and appends rather than rewriting.",
    "",
    "`tokens` is output + cache writes + fresh input, never cache reads, which",
    "would report the context size times the turn count. A session with no usage",
    "records is absent rather than zero.",
    "",
    "| session | requests | tokens | updated |",
    "|---|---|---|---|",
  ];
  const row = `| \`${session}\` | ~${n(round(u.calls, 500))} `
            + `| ~${n(round(u.tokens, 500000))} | ${new Date().toISOString().slice(0, 10)} |`;
  // Rows come from the staged file if it has any, otherwise from the tracked
  // log, so a summary staged before a fold does not lose the other sessions.
  let body = [];
  const source = (() => {
    try { if (fs.readFileSync(LOG, "utf8").includes("| `")) return LOG; } catch {}
    return "audit_log/usage.md";
  })();
  try {
    body = fs.readFileSync(source, "utf8").split("\n")
             .filter((l) => l.startsWith("| `") && !l.startsWith(`| \`${session}\` |`));
  } catch { /* first write */ }
  body.push(row);
  body.sort();
  const next = HEADER.concat(body).join("\n") + "\n";
  try {
    if (fs.readFileSync(LOG, "utf8") !== next) fs.writeFileSync(LOG, next);
  } catch { try { fs.writeFileSync(LOG, next); } catch { /* read-only */ } }

  // --- back into the conversation -------------------------------------------
  if (event.stop_hook_active === true) return;
  if (tripped) {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: { hookEventName: "Stop", additionalContext:
        `[tok] silenced: ${BREAKER_STOPS} stops inside ${BREAKER_WINDOW_MS / 1000}s, `
        + `which is faster than a person. turns.jsonl still has every line.` },
    }));
    return;
  }
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: "Stop", additionalContext: line },
  }));
});
