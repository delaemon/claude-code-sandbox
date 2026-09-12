#!/usr/bin/env bash
# PreToolUse hook: block edits to secret-bearing files.
#
# Reads the tool call as JSON on stdin; exit 2 blocks the call and shows stderr
# to Claude. Runs identically in a cloud session and in the dev container, which
# is the whole point — a guard that works in only one of them protects nothing
# in the other.
#
# It parses with `node`, not `python3`. The project is TypeScript, so node is
# present wherever this repository is usable, while python3 is incidental. An
# earlier version used python3 and, on a host without it, exited 0 and waved
# `.env` straight through. A guard that cannot run must never look like a guard
# that passed, so when the parse is unavailable this falls back to reading the
# raw payload and still refuses.
set -uo pipefail

raw=$(cat)

# Basenames that are refused. Used on the parsed path, and as the fallback
# needle when there is no parse.
SECRET_RE='(\.env($|\.)|\.pem"?$|\.key"?$|\.session_ingress_token)'

path=''
parsed=1
if command -v node >/dev/null 2>&1; then
  path=$(printf '%s' "$raw" | node -e '
    let s = "";
    process.stdin.on("data", d => (s += d));
    process.stdin.on("end", () => {
      try {
        process.stdout.write(String(JSON.parse(s)?.tool_input?.file_path ?? ""));
      } catch {
        process.exit(3);
      }
    });
  ' 2>/dev/null) && parsed=0
fi

if [ "$parsed" -eq 0 ]; then
  if printf '%s\n' "${path##*/}" | grep -qE "$SECRET_RE"; then
    echo "Blocked: $path holds credentials and must not be edited by Claude. Ask the user to change it by hand." >&2
    exit 2
  fi
  exit 0
fi

# No parser, or unparseable input. Decide from the raw payload rather than
# assume the call is safe. This over-blocks — a credential path merely mentioned
# anywhere in the JSON is enough — which is the direction this hook should err.
if printf '%s\n' "$raw" | grep -qE "$SECRET_RE"; then
  echo "Blocked: this tool call names a credential file, and the hook could not parse it to be certain (node missing, or malformed input). Refusing rather than guessing." >&2
  exit 2
fi
exit 0
