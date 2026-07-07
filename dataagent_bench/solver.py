"""The solve agent: a tool-use loop that must compute its answer with Python.

Design points that differ from the official baseline:
- Exploration is pre-done: the first user message already contains a full
  deterministic profile of every context file (profiler.py), so steps are
  spent on solving, not on ls/head round-trips.
- The answer is never produced by the model directly: prediction.csv must be
  written by executed Python code (run_python), making code the source of truth.
- submit runs the format validator; violations bounce back into the loop as a
  tool error the agent can fix, instead of becoming a scored zero.
"""
import json
import shutil
import sqlite3
from dataclasses import dataclass
from pathlib import Path

from . import config, llm
from .profiler import profile_context
from .sandbox import Sandbox
from .task import Task
from .validator import validate

SYSTEM = """You are a data analysis agent competing on DataAgent-Bench. You are given a task and a profile of every file in the task's context directory. Your job is to produce prediction.csv answering the task.

Hard rules:
1. NEVER answer from reading data yourself — every number/row in the final answer must be computed by Python code you run with the run_python tool. Print intermediate results to verify them.
2. Write the final answer with pandas: df.to_csv(OUT, index=False). OUT is a pre-bound variable in every snippet (as is TASK_DIR, the absolute path of the task directory; context files are under os.path.join(TASK_DIR, "context") unless the profile says otherwise).
3. Match the requested output format exactly: column names, column order, one row per requested entity. If the task specifies rounding or units, apply them in code.
4. Work in two phases: first run small verification snippets (row counts, joins, sanity checks) to pin down the correct interpretation; then compute and write the full answer.
5. If the task is ambiguous, pick the most literal reading of the task text and note the assumption in your submit notes.
6. When done, call submit. If submit reports validation errors, fix prediction.csv with more code and submit again.
"""

ALT_ROUTE_HINT = {
    "sql": "\nRoute constraint for this run: derive the answer primarily via SQL "
           "(sqlite3 / pandas.read_sql) rather than pandas transformations, so this "
           "run is an independent cross-check of a pandas-based solution.",
    "pandas": "\nRoute constraint for this run: derive the answer with pure pandas "
              "(no SQL), loading files directly, so this run is an independent "
              "cross-check of a SQL-based solution.",
}

RUN_PYTHON = {
    "name": "run_python",
    "description": "Execute a Python snippet. TASK_DIR and OUT are pre-bound. "
                   "stdout/stderr are returned. Each snippet is a fresh process: "
                   "re-import and re-load what you need.",
    "input_schema": {
        "type": "object",
        "properties": {"code": {"type": "string", "description": "Python source to execute"}},
        "required": ["code"],
    },
}

QUERY_SQLITE = {
    "name": "query_sqlite",
    "description": "Run a read-only SQL query against a SQLite file in the context "
                   "directory and return up to 50 rows. Convenience wrapper — for "
                   "the final answer still write prediction.csv via run_python.",
    "input_schema": {
        "type": "object",
        "properties": {
            "db": {"type": "string", "description": "Path of the .sqlite/.db file relative to the context directory"},
            "sql": {"type": "string", "description": "SELECT statement"},
        },
        "required": ["db", "sql"],
    },
}

READ_FILE = {
    "name": "read_file",
    "description": "Read a text file from the context directory (bounded excerpt). "
                   "Use for documents; use run_python for data files.",
    "input_schema": {
        "type": "object",
        "properties": {
            "path": {"type": "string", "description": "Path relative to the context directory"},
            "offset": {"type": "integer", "description": "Character offset to start from (default 0)"},
        },
        "required": ["path"],
    },
}

SUBMIT = {
    "name": "submit",
    "description": "Declare prediction.csv final. Runs format validation; on "
                   "errors you must fix the file and submit again.",
    "input_schema": {
        "type": "object",
        "properties": {
            "notes": {"type": "string", "description": "One-paragraph summary of the approach and any assumption made"},
        },
        "required": ["notes"],
    },
}


@dataclass
class SolveResult:
    ok: bool
    prediction_path: Path | None
    notes: str
    steps: int
    transcript_path: Path | None = None


class SolveAgent:
    def __init__(self, task: Task, work_dir: Path, temperature: float = 0.2,
                 route: str | None = None, verbose: bool = True):
        self.task = task
        self.sandbox = Sandbox(task.task_dir, work_dir)
        self.temperature = temperature
        self.route = route
        self.verbose = verbose
        self.client = llm.make_client()

    def log(self, msg: str) -> None:
        if self.verbose:
            print(f"[solve t={self.temperature}{' ' + self.route if self.route else ''}] {msg}")

    # ── tool handlers ─────────────────────────────────────────────────────────

    def _handle_query_sqlite(self, inputs: dict) -> str:
        db_path = (self.task.context_dir / inputs["db"]).resolve()
        if not str(db_path).startswith(str(self.task.context_dir.resolve())):
            return "Tool error: path escapes the context directory"
        try:
            conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
            try:
                cur = conn.execute(inputs["sql"])
                cols = [d[0] for d in cur.description] if cur.description else []
                rows = cur.fetchmany(50)
            finally:
                conn.close()
        except Exception as e:
            return f"SQL error: {e}"
        out = json.dumps({"columns": cols, "rows": [list(r) for r in rows]},
                         ensure_ascii=False, default=str)
        return out[: config.TOOL_OUTPUT_LIMIT]

    def _handle_read_file(self, inputs: dict) -> str:
        path = (self.task.context_dir / inputs["path"]).resolve()
        if not str(path).startswith(str(self.task.context_dir.resolve())):
            return "Tool error: path escapes the context directory"
        try:
            text = path.read_text(errors="replace")
        except Exception as e:
            return f"Read error: {e}"
        offset = int(inputs.get("offset", 0))
        chunk = text[offset: offset + config.TOOL_OUTPUT_LIMIT]
        tail = f"\n...[{len(text) - offset - len(chunk)} more chars]" \
            if offset + len(chunk) < len(text) else ""
        return chunk + tail

    def _handle_submit(self, inputs: dict) -> tuple[str, bool]:
        """Returns (tool result, accepted)."""
        res = validate(self.sandbox.out_path, self.task.output_columns or None)
        if not res.ok:
            return ("Submission rejected by validator:\n" + res.report()
                    + "\nFix prediction.csv with run_python and submit again."), False
        return "Submission accepted.\n" + res.report(), True

    # ── main loop ─────────────────────────────────────────────────────────────

    def run(self) -> SolveResult:
        profile = profile_context(self.task.context_dir)
        system = SYSTEM + (ALT_ROUTE_HINT.get(self.route, "") if self.route else "")
        user = (
            f"# Task (task.json)\n```json\n{json.dumps(self.task.raw, ensure_ascii=False, indent=2)[:4000]}\n```\n\n"
            f"# Question\n{self.task.question}\n\n"
            + (f"# Required output columns\n{self.task.output_columns}\n\n" if self.task.output_columns else "")
            + profile
        )
        tools = [RUN_PYTHON, QUERY_SQLITE, READ_FILE, SUBMIT]
        messages = [{"role": "user", "content": user}]
        notes = ""
        accepted = False

        for step in range(1, config.MAX_STEPS + 1):
            response = llm.create_message(
                self.client, system=system, tools=tools,
                messages=messages, temperature=self.temperature)
            messages.append({"role": "assistant", "content": response.content})

            if response.stop_reason != "tool_use":
                self.log(f"stopped without submit (stop_reason={response.stop_reason})")
                break

            tool_results = []
            for block in response.content:
                if block.type != "tool_use":
                    continue
                name, inputs = block.name, block.input
                self.log(f"step {step}: {name}({json.dumps(inputs, ensure_ascii=False)[:100]})")
                if name == "run_python":
                    result = self.sandbox.run_python(inputs.get("code", ""))
                elif name == "query_sqlite":
                    result = self._handle_query_sqlite(inputs)
                elif name == "read_file":
                    result = self._handle_read_file(inputs)
                elif name == "submit":
                    result, accepted = self._handle_submit(inputs)
                    if accepted:
                        notes = inputs.get("notes", "")
                else:
                    result = f"Unknown tool: {name}"
                tool_results.append({"type": "tool_result", "tool_use_id": block.id,
                                     "content": result})
            messages.append({"role": "user", "content": tool_results})
            if accepted:
                break
        else:
            step = config.MAX_STEPS

        transcript = self.sandbox.work_dir / "transcript.json"
        transcript.write_text(json.dumps(
            _serialize_messages(messages), ensure_ascii=False, indent=1))

        # even without an accepted submit, a written prediction.csv is worth keeping
        ok = accepted or self.sandbox.out_path.exists()
        if not accepted and self.sandbox.out_path.exists():
            self.log("no accepted submit, but prediction.csv exists — keeping it")
        return SolveResult(ok=ok,
                           prediction_path=self.sandbox.out_path if ok else None,
                           notes=notes, steps=step, transcript_path=transcript)


def _serialize_messages(messages: list) -> list:
    out = []
    for m in messages:
        content = m["content"]
        if isinstance(content, str):
            out.append({"role": m["role"], "content": content})
            continue
        blocks = []
        for b in content:
            if isinstance(b, dict):
                blocks.append({k: (v if isinstance(v, (str, int, float, bool, type(None)))
                                   else str(v)[:2000]) for k, v in b.items()})
            elif getattr(b, "type", None) == "text":
                blocks.append({"type": "text", "text": b.text})
            elif getattr(b, "type", None) == "tool_use":
                blocks.append({"type": "tool_use", "name": b.name,
                               "input": json.loads(json.dumps(b.input, default=str))})
            else:
                blocks.append({"type": str(getattr(b, "type", "?"))})
        out.append({"role": m["role"], "content": blocks})
    return out


def solve_once(task: Task, work_dir: Path, temperature: float,
               route: str | None = None, verbose: bool = True) -> SolveResult:
    if work_dir.exists():
        shutil.rmtree(work_dir)
    return SolveAgent(task, work_dir, temperature, route, verbose).run()
