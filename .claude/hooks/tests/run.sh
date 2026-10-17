#!/usr/bin/env bash
# Tests for the hook scripts in ../: record-touched.sh, check-plugin-id.sh, gate-on-stop.sh and
# the marker they share. Runs them against a throwaway clone of this repo with its own TMPDIR, so
# the checkout and the real session markers are never touched. Needs `claude` and `jq`.
# Usage: .claude/hooks/tests/run.sh   (exit 0 when every assertion holds)
set -u
SRC="$(cd "$(dirname "$0")/../../.." && pwd)"
# Resolved with -P: the scripts resolve the checkout the same way, and the marker path hashes it.
S="$(cd -P "$(mktemp -d)" && pwd)"
TMPDIR="$(cd -P "$(mktemp -d)" && pwd)"; export TMPDIR
export CLAUDE_PROJECT_DIR="$S"
trap 'rm -rf "$S" "$TMPDIR"' EXIT

git clone -q "$SRC" "$S" || exit 1
mkdir -p "$S/.claude/hooks" && cp "$SRC"/.claude/hooks/*.sh "$S/.claude/hooks/" && chmod +x "$S"/.claude/hooks/*.sh
cd "$S" || exit 1

H=.claude/hooks
SID='"session_id":"test-session"'
MARKER="$TMPDIR/claude-plugins-gate/test-session-$(printf '%s' "$S" | cksum | cut -d' ' -f1)"
mkdir -p "$(dirname "$MARKER")"
failures=0

pass() { printf '(pass) %s\n' "$1"; }
fail() { printf '(FAIL) %s\n  %s\n' "$1" "$2"; failures=$((failures + 1)); }
assert_eq() { [ "$2" = "$3" ] && pass "$1" || fail "$1" "expected [$3], got [$2]"; }
assert_contains() { printf '%s' "$2" | grep -qF -- "$3" && pass "$1" || fail "$1" "missing [$3] in: $2"; }
assert_not_contains() { printf '%s' "$2" | grep -qF -- "$3" && fail "$1" "unexpected [$3] in: $2" || pass "$1"; }
record() { printf '{%s,"tool_name":"%s","tool_input":%s}' "$SID" "$1" "$2" | $H/record-touched.sh; }
stop() { printf '{%s,"stop_hook_active":%s}' "$SID" "$1" | $H/gate-on-stop.sh; }
marker() { [ -f "$MARKER" ] && sort -u "$MARKER" | tr '\n' ' ' | sed 's/ $//' || printf ''; }
restore() { git checkout -q . && git clean -qfd plugins && rm -f "$MARKER"; }

# check-plugin-id.sh
out="$($H/check-plugin-id.sh)"; assert_eq "id check is silent on a clean clone" "$?:$out" "0:"

sed -i '' "s/plugin: 'agent-model-label'/plugin: 'other'/" plugins/agent-model-label/hooks/register.ts
out="$($H/check-plugin-id.sh)"; assert_contains "id check catches a state id written without atom()" "$out" "a state id names another plugin: plugin: 'other'"
restore

python3 -c "p='.claude-plugin/marketplace.json'; s=open(p).read().replace('\"name\": \"model-limits\",','\"name\": \"model-limits\"',1); open(p,'w').write(s)"
out="$($H/check-plugin-id.sh)"; assert_eq "id check reports malformed marketplace JSON once" "$out" "- .claude-plugin/marketplace.json is not valid JSON"
restore

jq '.plugins += [{"name":"ghost","source":"./plugins/ghost","description":"Gone."}]' .claude-plugin/marketplace.json > m.json && mv m.json .claude-plugin/marketplace.json
printf '| [`phantom`](plugins/phantom) | Nothing. | none |\n' >> README.md
mkdir -p plugins/zz-probe/.claude-plugin plugins/zz-probe/hooks "plugins/Bad Name"
printf '{"name":"zz-wrong","version":"0.1.0"}\n' > plugins/zz-probe/.claude-plugin/plugin.json
printf "const s = { plugin: 'zz-probe', key: 'x' }\n" > plugins/zz-probe/hooks/register.ts
out="$($H/check-plugin-id.sh)"
assert_contains "id check rejects a folder name outside the id grammar" "$out" "plugins/Bad Name: not a kebab-case id"
assert_contains "id check compares manifest name with folder" "$out" "name is 'zz-wrong', folder is 'zz-probe'"
assert_contains "id check wants a marketplace entry" "$out" "has no entry named 'zz-probe'"
assert_contains "id check wants types/index.d.ts when hooks keep state" "$out" "keeps state but has no plugins/zz-probe/types/index.d.ts"
assert_contains "id check wants a README row" "$out" "Plugins table has no row for 'zz-probe'"
assert_contains "id check reports a marketplace entry without a folder" "$out" "marketplace.json names 'ghost', which has no plugins/ folder"
assert_contains "id check reports a README row without a folder" "$out" "README.md names 'phantom', which has no plugins/ folder"

# record-touched.sh
printf 'zz-probe\n' > "$MARKER"
out="$(stop false)"
assert_contains "gate blocks on id findings" "$out" '"decision": "block"'
assert_contains "gate labels its output as untrusted" "$out" "not instructions"
assert_contains "gate includes the id findings" "$out" "has no entry named 'zz-probe'"
assert_contains "gate includes the test runner's line" "$out" "no hooks module to load"
out="$(stop true | jq -r 'keys | join(",")')"; assert_eq "gate only reports once already blocked" "$out" "systemMessage"
[ -f "$MARKER" ] && pass "gate keeps the marker while failing" || fail "gate keeps the marker while failing" "marker removed"
restore

record Write "{\"file_path\":\"$S/plugins/model-limits/hooks/register.ts\"}"; assert_eq "record: absolute path under plugins/<id>" "$(marker)" "model-limits"
record Edit "{\"file_path\":\"$S/CLAUDE.md\"}"; assert_eq "record: a file outside plugins/ adds nothing" "$(marker)" "model-limits"
record Bash '{"command":"git status"}'; assert_eq "record: a Bash command not naming plugins adds nothing" "$(marker)" "model-limits"
record Bash '{"command":"sed -i s/a/b/ plugins/context-bar/hooks/register.tsx"}'; assert_eq "record: a Bash command naming plugins/ marks every plugin" "$(marker)" "* model-limits"
rm -f "$MARKER"
CLAUDE_PROJECT_DIR="$S/" record Edit '{"file_path":"plugins/agent-model-label/types/index.d.ts"}'; assert_eq "record: relative path with a trailing-slash project dir" "$(marker)" "agent-model-label"
record Write "{\"file_path\":\"$S/.claude-plugin/marketplace.json\"}"; assert_eq "record: the marketplace marks every plugin" "$(marker)" "* agent-model-label"

# gate-on-stop.sh
out="$(stop false)"; assert_eq "gate passes on a clean clone and says nothing" "$?:$out" "0:"
[ -f "$MARKER" ] && fail "gate clears the marker on pass" "marker still present" || pass "gate clears the marker on pass"
out="$(stop false)"; assert_eq "gate with no marker does nothing" "$?:$out" "0:"

printf '\nconst broken = ;\n' >> plugins/model-limits/hooks/register.ts
claude plugin validate . >/dev/null 2>&1 && pass "validate passes a hooks module with a syntax error (CLAUDE.md states this; update it if this fails)" || fail "validate passes a hooks module with a syntax error" "validate now fails on module syntax; update CLAUDE.md"
printf 'model-limits\n' > "$MARKER"
out="$(stop false)"
assert_contains "gate blocks on a failing test run" "$out" '"decision": "block"'
assert_contains "gate summarises the failing test" "$out" "(fail) the file did not load"
assert_not_contains "gate does not dump passing lines" "$out" "(pass)"
restore

printf '\n%d failing\n' "$failures"
exit "$failures"
