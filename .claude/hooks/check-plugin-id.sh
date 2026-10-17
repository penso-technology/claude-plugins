#!/usr/bin/env bash
# One plugin id in five places (CLAUDE.md, Invariants): the folder, plugin.json, the marketplace
# entry, the PluginState key and every `plugin: '<id>'` state id in hooks/, and the README table
# row; and the reverse, every marketplace entry and README row names a folder that exists. Prints
# one finding per line and exits 1 when there are any. Run from the repo root by the Stop gate, or
# by hand. Text copied out of a file is cut and stripped of control characters before it is shown.
set -u
cd "${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}" || exit 0
command -v jq >/dev/null 2>&1 || { echo "- jq is not installed; the id check did not run"; exit 1; }

MARKETPLACE=.claude-plugin/marketplace.json
ID_GRAMMAR='^[a-z][a-z0-9]*(-[a-z0-9]+)*$'
findings=0

note() { printf -- '- %s\n' "$1"; findings=1; }
shown() { printf '%s' "$1" | tr -d '\000-\037\177' | cut -c1-64; }
valid_json() { jq empty "$1" >/dev/null 2>&1; }

check_manifest() {
  local id="$1" manifest="plugins/$1/.claude-plugin/plugin.json" name
  [ -f "$manifest" ] || { note "$manifest is missing"; return; }
  valid_json "$manifest" || { note "$manifest is not valid JSON"; return; }
  name="$(jq -r '.name // empty' "$manifest")"
  [ "$name" = "$id" ] || note "$manifest: name is '$(shown "${name:-<missing>}")', folder is '$id'"
}

check_marketplace_entry() {
  local id="$1" source
  source="$(jq -r --arg id "$id" '.plugins[] | select(.name == $id) | .source // empty' "$MARKETPLACE")"
  if [ -z "$source" ]; then
    note "$MARKETPLACE has no entry named '$id'"
  elif [ "$source" != "./plugins/$id" ]; then
    note "$MARKETPLACE: entry '$id' has source '$(shown "$source")', expected './plugins/$id'"
  fi
}

check_state_ids() {
  local id="$1" hooks="plugins/$1/hooks" types="plugins/$1/types/index.d.ts" stray
  stray="$(grep -rhoE "plugin: '[^']*'" "$hooks" 2>/dev/null | grep -vF "'$id'" | sort -u | tr '\n' ' ')"
  [ -z "$stray" ] || note "$hooks: a state id names another plugin: $(shown "$stray")"
  if grep -rqE "plugin: '" "$hooks" 2>/dev/null && [ ! -f "$types" ]; then
    note "plugins/$id keeps state but has no $types"
  fi
  if [ -f "$types" ] && grep -q PluginState "$types"; then
    grep -qF "'$id':" "$types" || note "$types: PluginState has no '$id' key"
  fi
}

check_readme_row() {
  grep -qF "[\`$1\`](plugins/$1)" README.md || note "README.md: Plugins table has no row for '$1'"
}

check_folder() {
  local id="$1"
  [[ "$id" =~ $ID_GRAMMAR ]] || { note "plugins/$(shown "$id"): not a kebab-case id"; return; }
  check_manifest "$id"
  check_marketplace_entry "$id"
  check_state_ids "$id"
  check_readme_row "$id"
}

check_has_folder() {
  local where="$1" id="$2"
  [ -d "plugins/$id" ] || note "$where names '$(shown "$id")', which has no plugins/ folder"
}

[ -f "$MARKETPLACE" ] || { note "$MARKETPLACE is missing"; exit 1; }
valid_json "$MARKETPLACE" || { note "$MARKETPLACE is not valid JSON"; exit 1; }
[ -f README.md ] || { note "README.md is missing"; exit 1; }

while IFS= read -r dir; do
  [ -n "$dir" ] && check_folder "$(basename "$dir")"
done < <(find plugins -mindepth 1 -maxdepth 1 -type d 2>/dev/null | sort)

while IFS= read -r id; do
  [ -n "$id" ] && check_has_folder "$MARKETPLACE" "$id"
done < <(jq -r '.plugins[].name // empty' "$MARKETPLACE")

while IFS= read -r id; do
  [ -n "$id" ] && check_has_folder "README.md" "$id"
done < <(sed -nE 's#^\| \[`([^`]+)`\]\(plugins/[^)]*\).*#\1#p' README.md)

exit "$findings"
