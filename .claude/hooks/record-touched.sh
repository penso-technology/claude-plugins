#!/usr/bin/env bash
# PostToolUse (Write|Edit|Bash): remembers which plugins this session changed, so the Stop gate
# (gate-on-stop.sh) tests only those and runs no test code the session did not touch. It checks
# nothing itself: a scaffold is written over several tool calls, and a check after each one would
# report the steps not yet taken. A Bash command that names plugins/, the marketplace or the README
# cannot be attributed to one plugin, so it marks every plugin ('*').
set -u
command -v jq >/dev/null 2>&1 || exit 0

INPUT="$(cat)"
ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
ROOT="$(cd -P "$ROOT" 2>/dev/null && pwd)" || exit 0
. "$(dirname "$0")/gate-marker.sh"

relative_to_root() {
  local file="$1" dir
  case "$file" in
    /*)
      dir="$(cd -P "$(dirname "$file")" 2>/dev/null && pwd)" && file="$dir/$(basename "$file")"
      printf '%s' "${file#"$ROOT"/}" ;;
    *) printf '%s' "$file" ;;
  esac
}

case "$(jq -r '.tool_name // empty' <<<"$INPUT")" in
  Bash)
    # `plugins/` as a path segment of its own: the checkout is itself named claude-plugins/.
    jq -r '.tool_input.command // empty' <<<"$INPUT" \
      | grep -qE '(^|[^A-Za-z0-9_.-])plugins/|marketplace\.json|README\.md' && mark '*' ;;
  *)
    file="$(jq -r '.tool_response.filePath // .tool_input.file_path // empty' <<<"$INPUT")"
    [ -n "$file" ] || exit 0
    rel="$(relative_to_root "$file")"
    case "$rel" in
      plugins/*/*) id="${rel#plugins/}"; mark "${id%%/*}" ;;
      .claude-plugin/marketplace.json|README.md) mark '*' ;;
    esac ;;
esac
exit 0
