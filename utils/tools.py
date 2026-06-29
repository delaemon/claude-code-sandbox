"""Shared tool definitions and handler dispatcher used by all agents."""
import os
import subprocess
import json
from pathlib import Path
from utils.workspace import Workspace


# ── tool schemas (Anthropic format) ──────────────────────────────────────────

WRITE_FILE = {
    "name": "write_file",
    "description": "Write content to a file inside the workspace.",
    "input_schema": {
        "type": "object",
        "properties": {
            "path": {"type": "string", "description": "Relative path inside the workspace (e.g. src/app.py)"},
            "content": {"type": "string", "description": "Text content to write"},
        },
        "required": ["path", "content"],
    },
}

READ_FILE = {
    "name": "read_file",
    "description": "Read a file from the workspace.",
    "input_schema": {
        "type": "object",
        "properties": {
            "path": {"type": "string", "description": "Relative path inside the workspace"},
        },
        "required": ["path"],
    },
}

LIST_FILES = {
    "name": "list_files",
    "description": "List all files in a workspace subdirectory.",
    "input_schema": {
        "type": "object",
        "properties": {
            "subdir": {"type": "string", "description": "Subdirectory to list (default '.')"},
        },
        "required": [],
    },
}

RUN_COMMAND = {
    "name": "run_command",
    "description": "Execute a shell command inside the workspace directory and return stdout+stderr.",
    "input_schema": {
        "type": "object",
        "properties": {
            "command": {"type": "string", "description": "Shell command to run (e.g. 'pytest tests/ -v')"},
        },
        "required": ["command"],
    },
}

FINISH = {
    "name": "finish",
    "description": "Signal that the agent has completed its task and return a structured result.",
    "input_schema": {
        "type": "object",
        "properties": {
            "summary": {"type": "string", "description": "Short summary of what was accomplished"},
            "artifacts": {
                "type": "array",
                "items": {"type": "string"},
                "description": "List of workspace-relative file paths produced",
            },
        },
        "required": ["summary"],
    },
}


# ── handler ───────────────────────────────────────────────────────────────────

class ToolHandler:
    def __init__(self, workspace: Workspace):
        self.ws = workspace

    def handle(self, name: str, inputs: dict) -> str:
        try:
            if name == "write_file":
                path = self.ws.write(inputs["path"], inputs["content"])
                return f"Written: {inputs['path']}"

            elif name == "read_file":
                content = self.ws.read(inputs["path"])
                return content

            elif name == "list_files":
                subdir = inputs.get("subdir", ".")
                files = self.ws.list_files(subdir)
                return json.dumps(files, ensure_ascii=False)

            elif name == "run_command":
                cmd = inputs["command"]
                result = subprocess.run(
                    cmd,
                    shell=True,
                    capture_output=True,
                    text=True,
                    cwd=str(self.ws.root),
                    timeout=120,
                )
                output = ""
                if result.stdout:
                    output += result.stdout
                if result.stderr:
                    output += "\n[stderr]\n" + result.stderr
                output += f"\n[exit code: {result.returncode}]"
                return output.strip()

            elif name == "finish":
                return json.dumps(inputs)

            else:
                return f"Unknown tool: {name}"
        except Exception as e:
            return f"Tool error ({name}): {e}"
