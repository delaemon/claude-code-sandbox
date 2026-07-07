"""Python snippet execution for the solve agent.

Each snippet runs as its own process in a per-run work directory, with TASK_DIR
(read-only by convention) and OUT (the prediction.csv path) exposed both as
environment variables and as pre-bound Python variables via a header prelude.
"""
import subprocess
import sys
from pathlib import Path

from . import config

_PRELUDE = """\
import os
TASK_DIR = os.environ["TASK_DIR"]
OUT = os.environ["OUT"]
"""


class Sandbox:
    def __init__(self, task_dir: Path, work_dir: Path):
        self.task_dir = Path(task_dir)
        self.work_dir = Path(work_dir)
        self.work_dir.mkdir(parents=True, exist_ok=True)
        self.out_path = self.work_dir / "prediction.csv"
        self._n = 0

    def run_python(self, code: str) -> str:
        self._n += 1
        script = self.work_dir / f"snippet_{self._n:02d}.py"
        script.write_text(_PRELUDE + code)
        try:
            proc = subprocess.run(
                [sys.executable, str(script)],
                capture_output=True, text=True,
                cwd=str(self.work_dir),
                timeout=config.PY_TIMEOUT_SEC,
                env={**__import__("os").environ,
                     "TASK_DIR": str(self.task_dir),
                     "OUT": str(self.out_path)},
            )
        except subprocess.TimeoutExpired:
            return f"[timeout after {config.PY_TIMEOUT_SEC}s]"
        output = proc.stdout
        if proc.stderr:
            output += "\n[stderr]\n" + proc.stderr
        output += f"\n[exit code: {proc.returncode}]"
        limit = config.TOOL_OUTPUT_LIMIT
        if len(output) > limit:
            output = output[: limit // 2] + "\n...[truncated]...\n" + output[-limit // 2:]
        return output.strip()
