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
// from a document that does not fully state it. That worked: two payloads in
// audit_log/subagents.jsonl show `transcript_path` is the parent session's, and
// that `agent_transcript_path` -- named nowhere in the published reference -- is
// the field that would retire the glob in export.py.
//
// So it is promoted to a known field and its value is now recorded. Knowing a
// field exists is not knowing what it holds, and export.py cannot be pointed at
// it until its value has been compared against what the glob finds. A path
// carries no conversation text, so recording it is safe in a public log.
//
// That comparison has now been made, and it says NOT to point export.py here.
// The first recorded value named
//   .../<session>/subagents/agent-<agent_id>.jsonl
// which is exactly the shape the glob looks for and is derivable from agent_id
// alone -- and the file did not exist, anywhere. The six transcripts the glob
// does find are all older, from runs that wrote one. So this field names where a
// transcript would go, not where one is: some subagents finish without leaving
// a file. It could augment the glob; it cannot replace it, and export.py keeps
// globbing.
//
// Recorded because the shapes matching was nearly taken for agreement.
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
  // Every entry here has its VALUE written to a file in a public repository, so
  // the list may only hold fields that cannot carry conversation text. Paths,
  // ids and modes qualify; anything message-shaped does not, which is why
  // last_assistant_message stays out and is recorded by name alone.
  const known = ["session_id", "agent_id", "agent_type", "hook_event_name",
                 "cwd", "permission_mode", "transcript_path",
                 "agent_transcript_path"];
  const row = { recorded_at: new Date().toISOString() };
  for (const k of known) if (event[k] !== undefined) row[k] = String(event[k]);
  row.other_fields = Object.keys(event).filter((k) => !known.includes(k)).sort();

  try {
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.appendFileSync(OUT, JSON.stringify(row) + "\n");
  } catch { /* read-only checkout: recording is best effort, never blocking */ }
});
