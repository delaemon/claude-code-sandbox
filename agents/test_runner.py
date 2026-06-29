"""Test Runner Agent: executes pytest and captures structured results."""
import json
import subprocess
from agents.base_agent import BaseAgent
from utils.tools import RUN_COMMAND, READ_FILE, WRITE_FILE, LIST_FILES


SYSTEM = """\
You are a CI/CD automation engineer.

Your job is to run the test suite and produce a structured test report.

Steps:
1. Use list_files to confirm what test files exist.
2. Run `pytest tests/ -v --tb=short --json-report --json-report-file=test_report.json` using run_command.
   - If pytest-json-report is not installed, first run `pip install pytest-json-report -q`.
3. Read test_report.json with read_file.
4. Write a human-readable summary to test_results_summary.md:
   - Total tests, passed, failed, errors, skipped
   - Table of all test names and their outcomes
   - Full traceback for every failure
5. Call finish with a summary line like "X/Y tests passed" and artifacts
   ["test_report.json", "test_results_summary.md"].

Tools available: run_command, read_file, write_file, list_files, finish
"""


class TestRunnerAgent(BaseAgent):
    name = "test_runner"
    system_prompt = SYSTEM
    tools = [RUN_COMMAND, READ_FILE, WRITE_FILE, LIST_FILES]
