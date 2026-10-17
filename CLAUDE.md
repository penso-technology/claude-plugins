# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Claude Code plugin marketplace (`penso-plugins`). Each plugin is a TypeScript **hooks module**:
`hooks/hooks.json` lists modules, and `hooks/register.ts` exports
`register: Register = on => { on('<event>', ($, e, next) => { ...; return next(e) }) }` against
the `claude-code` API (`session.start`, `turn.complete`, `ui.render`, `agent.spawn`, ...). The
classic command-hook docs (PreToolUse and friends) do not apply here. The README's Layout,
Adding a plugin and Developing sections are the procedure; this file holds only what they omit.

## Verification gate (before every commit)

- The three commands in the README's "Adding a plugin" steps 3 and 4 (validate, the tests of every
  plugin the change touches, tsc after one interactive load), as the README states them.
- The hooks in `.claude/settings.json` run part of this unasked. A PostToolUse hook records which
  plugins the session edits (a Bash command naming `plugins/`, the marketplace or the README
  counts as all of them); the Stop hook then runs the id check below over every plugin, `validate`,
  and the tests of the recorded plugins only, and blocks the stop with the failing lines until they
  pass. It runs no test code the session did not touch, and it does not run tsc. After a change
  to a hook script, run `.claude/hooks/tests/run.sh`: it exercises them in a throwaway clone.
- No lint or format tooling exists. Match the existing modules: no semicolons, single quotes,
  2-space indent, trailing commas, `import type` for types, `/** why */` comments, British spelling.

## Invariants

- One plugin id in five places: the folder name, `name` in `.claude-plugin/plugin.json`, the
  marketplace entry (`name` and `source: ./plugins/<id>`), the `PluginState` key in
  `types/index.d.ts` with every `plugin: '<id>'` state id in `hooks/`, and the README table row;
  and no entry or row without a folder. `.claude/hooks/check-plugin-id.sh` checks all of it.
- Bump `version` in `plugin.json` in the same commit as any change installers should receive. The
  marketplace entry carries no version, so `claude plugin update` ships nothing otherwise. Repo
  tags (`0.1.0`, `0.2.0`: bare, annotated) are marketplace releases, independent of plugin versions.
- `model-limits` writes a file under `$HOME/.claude` whose path and shape are a wire contract,
  stated once in its README, with `~/.claude/statusline-command.sh` (chezmoi-managed, outside this
  repo): a change to either changes that script in the same work item.
- Per-session state lives in `atom` / `$.state`, never in a module-level variable: `--plugin-dir`
  hot-reloads the module on save and drops module variables. The one deliberate exception is
  `inFlight` in `model-limits`, kept module-level so a reload drops the stale promise.
- `/new-plugin <id>` scaffolds in the shape of the existing plugins and writes the marketplace
  entry and README row; it is the one place the manifest and description conventions are stated.

## Git

git-flow with plain git (the git-flow CLI is not installed), without the PR layer: a solo repo
(owner, 2026-10-17), so work is committed on `develop` directly, no `feature/` branch, no PR, no
reviewer. `/release <v>` cuts a release to `main` and stops before any push. The installed
marketplace clone tracks `main`, so a change reaches installers only after a release. Commit
prefixes in use: `feat:`, `docs:`, `review:`.
