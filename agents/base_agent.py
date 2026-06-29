"""Base class for all agents: drives the tool-use agentic loop."""
import os
import json
import anthropic
from utils.workspace import Workspace
from utils.tools import ToolHandler, FINISH


MODEL = "claude-sonnet-4-6"
MAX_TOKENS = 8192

_TOKEN_FILE = "/home/claude/.claude/remote/.session_ingress_token"


def _make_client() -> anthropic.Anthropic:
    """Create an Anthropic client using API key or OAuth token (Claude Code remote env)."""
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if api_key:
        return anthropic.Anthropic(api_key=api_key)
    if os.path.exists(_TOKEN_FILE):
        token = open(_TOKEN_FILE).read().strip()
        return anthropic.Anthropic(auth_token=token)
    raise RuntimeError("No API key: set ANTHROPIC_API_KEY or run inside Claude Code remote.")


class BaseAgent:
    name: str = "agent"
    system_prompt: str = ""
    tools: list = []

    def __init__(self, workspace: Workspace, verbose: bool = True):
        self.ws = workspace
        self.verbose = verbose
        self.client = _make_client()
        self.handler = ToolHandler(workspace)
        self._finish_result: dict | None = None

    def log(self, msg: str) -> None:
        if self.verbose:
            print(f"[{self.name}] {msg}")

    def run(self, user_message: str) -> dict:
        """
        Agentic loop: send message → handle tool calls → repeat until 'finish' tool or end_turn.
        Returns the finish payload (summary + artifacts) or a default dict.
        """
        self.log(f"Starting...")
        messages = [{"role": "user", "content": user_message}]
        all_tools = self.tools + [FINISH]

        while True:
            response = self.client.messages.create(
                model=MODEL,
                max_tokens=MAX_TOKENS,
                system=self.system_prompt,
                tools=all_tools,
                messages=messages,
            )

            # append assistant turn
            messages.append({"role": "assistant", "content": response.content})

            if response.stop_reason == "end_turn":
                self.log("Finished (end_turn).")
                break

            if response.stop_reason == "tool_use":
                tool_results = []
                finished = False

                for block in response.content:
                    if block.type != "tool_use":
                        continue

                    tool_name = block.name
                    tool_input = block.input
                    self.log(f"Tool: {tool_name}({json.dumps(tool_input)[:120]})")

                    result = self.handler.handle(tool_name, tool_input)

                    if tool_name == "finish":
                        self._finish_result = tool_input
                        finished = True

                    tool_results.append({
                        "type": "tool_result",
                        "tool_use_id": block.id,
                        "content": result,
                    })

                messages.append({"role": "user", "content": tool_results})

                if finished:
                    self.log("Finished (finish tool called).")
                    break
            else:
                self.log(f"Unexpected stop_reason: {response.stop_reason}")
                break

        if self._finish_result:
            return self._finish_result
        # fallback: collect text from last assistant message
        text = " ".join(
            b.text for b in response.content if hasattr(b, "text")
        )
        return {"summary": text, "artifacts": self.ws.list_files()}
