#!/usr/bin/env bash
# PreToolUse hook: block edits to secret-bearing files.
# Reads the tool call as JSON on stdin; exit 2 blocks the call and shows stderr to Claude.
set -euo pipefail

path=$(python3 -c '
import json, sys
data = json.load(sys.stdin)
print(data.get("tool_input", {}).get("file_path", ""))
')

case "$(basename "$path")" in
  .env|.env.*|*.pem|*.key|.session_ingress_token)
    echo "Blocked: $path holds credentials (ANTHROPIC_API_KEY etc.) and must not be edited by Claude. Ask the user to change it by hand." >&2
    exit 2
    ;;
esac
exit 0
