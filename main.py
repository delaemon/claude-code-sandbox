#!/usr/bin/env python3
"""
Multi-Agent Coding Pipeline
Usage:
  python main.py "your task description"
  python main.py  # interactive prompt
"""
import sys
import os
from orchestrator import Orchestrator


def main():
    if len(sys.argv) > 1:
        task = " ".join(sys.argv[1:])
    else:
        print("Multi-Agent Coding Pipeline")
        print("Enter the task description (Ctrl+D to submit):\n")
        try:
            task = sys.stdin.read().strip()
        except EOFError:
            print("No input received.")
            sys.exit(1)

    if not task:
        print("Error: task description cannot be empty.")
        sys.exit(1)

    _TOKEN_FILE = "/home/claude/.claude/remote/.session_ingress_token"
    if not os.environ.get("ANTHROPIC_API_KEY") and not os.path.exists(_TOKEN_FILE):
        print("Error: set ANTHROPIC_API_KEY or run inside Claude Code remote environment.")
        sys.exit(1)

    print(f"\nTask: {task}\n")
    orchestrator = Orchestrator(verbose=True)
    workspace = orchestrator.run(task)
    print(f"Done. All artifacts saved to: {workspace}")


if __name__ == "__main__":
    main()
