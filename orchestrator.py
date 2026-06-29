"""
Orchestrator: coordinates all agents in sequence and streams progress to the console.

Flow:
  Task description
    → RequirementsAgent    → requirements.md
    → ImplementationAgent  → src/*.py
    → TestGeneratorAgent   → tests/*.py
    → TestRunnerAgent      → test_report.json, test_results_summary.md
    → ReporterAgent        → final_report.md
"""
import sys
import json
import textwrap
from pathlib import Path
from datetime import datetime

from utils.workspace import Workspace
from agents.requirements_agent import RequirementsAgent
from agents.implementation_agent import ImplementationAgent
from agents.test_generator import TestGeneratorAgent
from agents.test_runner import TestRunnerAgent
from agents.reporter import ReporterAgent


BANNER = "=" * 60


def _header(title: str) -> None:
    print(f"\n{BANNER}")
    print(f"  {title}")
    print(BANNER)


def _result(result: dict) -> None:
    print(f"  Summary  : {result.get('summary', '')}")
    artifacts = result.get("artifacts", [])
    if artifacts:
        print(f"  Artifacts: {', '.join(artifacts)}")


class Orchestrator:
    def __init__(self, verbose: bool = True):
        self.verbose = verbose

    def run(self, task: str) -> Path:
        """
        Execute the full pipeline for the given task description.
        Returns the path to the workspace run directory.
        """
        ws = Workspace(base_dir="workspace")
        print(f"\nWorkspace: {ws.root}")
        ws.set_meta("task", task)
        ws.set_meta("started_at", datetime.now().isoformat())

        # ── 1. Requirements ──────────────────────────────────────────────────
        _header("PHASE 1 / 5 — Requirements Definition")
        req_agent = RequirementsAgent(ws, verbose=self.verbose)
        req_result = req_agent.run(
            f"Analyse this task and produce a complete requirements document:\n\n{task}"
        )
        _result(req_result)
        ws.set_meta("requirements_result", req_result)

        # ── 2. Implementation ────────────────────────────────────────────────
        _header("PHASE 2 / 5 — Implementation")
        requirements_md = ws.read("requirements.md")
        impl_agent = ImplementationAgent(ws, verbose=self.verbose)
        impl_result = impl_agent.run(
            f"Implement the following requirements:\n\n{requirements_md}"
        )
        _result(impl_result)
        ws.set_meta("implementation_result", impl_result)

        # ── 3. Test Generation ───────────────────────────────────────────────
        _header("PHASE 3 / 5 — Test Generation")
        src_files = ws.list_files("src")
        src_context = "\n\n".join(
            f"### {f}\n```python\n{ws.read(f)}\n```"
            for f in src_files
        )
        tgen_agent = TestGeneratorAgent(ws, verbose=self.verbose)
        tgen_result = tgen_agent.run(
            f"Write a pytest test suite.\n\n"
            f"## Requirements\n{requirements_md}\n\n"
            f"## Source Files\n{src_context}"
        )
        _result(tgen_result)
        ws.set_meta("test_gen_result", tgen_result)

        # ── 4. Test Execution ────────────────────────────────────────────────
        _header("PHASE 4 / 5 — Test Execution")
        test_files = ws.list_files("tests")
        runner_agent = TestRunnerAgent(ws, verbose=self.verbose)
        runner_result = runner_agent.run(
            f"Run the test suite. Test files present: {json.dumps(test_files)}\n"
            f"Workspace root contains: {json.dumps(ws.list_files())}"
        )
        _result(runner_result)
        ws.set_meta("test_runner_result", runner_result)

        # ── 5. Report ────────────────────────────────────────────────────────
        _header("PHASE 5 / 5 — Final Report")
        reporter_agent = ReporterAgent(ws, verbose=self.verbose)
        report_result = reporter_agent.run(
            f"Compile the final report. All workspace files:\n"
            f"{json.dumps(ws.list_files(), indent=2)}"
        )
        _result(report_result)
        ws.set_meta("report_result", report_result)
        ws.set_meta("finished_at", datetime.now().isoformat())

        # ── Done ─────────────────────────────────────────────────────────────
        _header("PIPELINE COMPLETE")
        report_path = ws.root / "final_report.md"
        if report_path.exists():
            print(f"\nFinal report: {report_path}")
        print(f"Workspace   : {ws.root}\n")

        return ws.root
