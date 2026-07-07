"""Anthropic client with retries. Mirrors agents/base_agent.py's auth fallback."""
import os
import time
import anthropic

from . import config

_TOKEN_FILE = "/home/claude/.claude/remote/.session_ingress_token"


def make_client() -> anthropic.Anthropic:
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if api_key:
        return anthropic.Anthropic(api_key=api_key)
    if os.path.exists(_TOKEN_FILE):
        token = open(_TOKEN_FILE).read().strip()
        return anthropic.Anthropic(auth_token=token)
    raise RuntimeError("No API key: set ANTHROPIC_API_KEY or run inside Claude Code remote.")


_temperature_supported = True  # newest models reject the temperature param


def create_message(client, *, system, tools, messages, temperature=0.0, max_retries=5):
    """messages.create with exponential backoff on transient API errors."""
    global _temperature_supported
    delay = 2.0
    for attempt in range(max_retries):
        kwargs = {"temperature": temperature} if _temperature_supported else {}
        try:
            return client.messages.create(
                model=config.MODEL,
                max_tokens=config.MAX_TOKENS,
                system=system,
                tools=tools,
                messages=messages,
                **kwargs,
            )
        except anthropic.BadRequestError as e:
            if _temperature_supported and "temperature" in str(e):
                _temperature_supported = False
                continue
            raise
        except (anthropic.APIStatusError, anthropic.APIConnectionError) as e:
            status = getattr(e, "status_code", None)
            retriable = status in (429, 500, 502, 503, 529) or isinstance(
                e, anthropic.APIConnectionError
            )
            if not retriable or attempt == max_retries - 1:
                raise
            time.sleep(delay)
            delay *= 2
