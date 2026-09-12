// SubagentStop: record what the harness actually says about a finished subagent.
//
// audit_log/export.py finds subagent transcripts by globbing
// `*/*/subagents/agent-*.jsonl` under the Claude config directory. That is a
// guess about an internal layout, and while it is not silent when it breaks --
// export.py exits 1 on an empty result, which was checked -- a guess that
// happens to be right is still a guess.
//
// The documented schema for this event is incomplete: `agent_id` and
// `agent_type` are named, and `transcript_path` is described in a way that
// suggests it is the PARENT session's, not the subagent's. So this does not
// pretend to know the shape. It records the payload verbatim, minus anything
// that looks like content, and export.py reconciles against it.
//
// The first job is therefore to learn the schema from the harness rather than
// from a document that does not fully state it.
import fs from "node:fs";
import path from "node:path";

const OUT = process.env.SUBAGENT_INDEX || "audit_log/subagents.jsonl";

let raw = "";
process.stdin.on("data", (d) => (raw += d)).on("end", () => {
  let event;
  try { event = JSON.parse(raw); } catch { return; }
  if (!event || typeof event !== "object") return;

  // Keep the identifying fields and the names of everything else. The values of
  // unknown fields are not copied: this file is committed to a public
  // repository and an unrecognised field could hold conversation text.
  const known = ["session_id", "agent_id", "agent_type", "hook_event_name",
                 "cwd", "permission_mode", "transcript_path"];
  const row = { recorded_at: new Date().toISOString() };
  for (const k of known) if (event[k] !== undefined) row[k] = String(event[k]);
  row.other_fields = Object.keys(event).filter((k) => !known.includes(k)).sort();

  try {
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.appendFileSync(OUT, JSON.stringify(row) + "\n");
  } catch { /* read-only checkout: recording is best effort, never blocking */ }
});
