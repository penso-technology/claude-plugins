# Sourced by record-touched.sh and gate-on-stop.sh: where a session's marker lives, stated once.
# One file per session and checkout under the user's temp dir, one plugin id per line, or '*' for
# every plugin. The caller sets INPUT (the hook's stdin JSON) and ROOT (the checkout) first.
marker_path() {
  local sid dir
  sid="$(jq -r '.session_id // empty' <<<"$INPUT" 2>/dev/null | tr -cd 'A-Za-z0-9_-' | cut -c1-80)"
  dir="${TMPDIR:-/tmp}/claude-plugins-gate"
  mkdir -p "$dir" 2>/dev/null && chmod 700 "$dir" 2>/dev/null
  printf '%s/%s-%s' "$dir" "${sid:-no-session}" "$(printf '%s' "$ROOT" | cksum | cut -d' ' -f1)"
}

mark() { printf '%s\n' "$1" >> "$(marker_path)"; }
