---
name: new-plugin
description: Scaffold a new plugin in this marketplace in the exact shape of the existing ones (manifest, hooks module, types, test, README), register it in marketplace.json and the README table, then run the verification gate. Use when asked to add, create or scaffold a plugin here.
---

Scaffold `plugins/$ARGUMENTS/`. The argument is the plugin id; when it is missing, ask for it.

## Preconditions

1. The id is lowercase kebab-case (`^[a-z][a-z0-9]*(-[a-z0-9]+)*$`) and `plugins/<id>/` does
   not exist. The same string goes in every place listed in CLAUDE.md ("one plugin id in five
   places"); never vary it.
2. Read one existing plugin end to end first (`plugins/model-limits` for a module that draws
   nothing, `plugins/context-bar` for one that renders JSX) and copy its shape, not a memory of it.
3. Ask what the plugin does, which events it answers (`session.start`, `turn.complete`,
   `ui.render`, `agent.spawn`, `session.measure`, `command.run`, ...) and whether it keeps
   state. State decides whether `types/index.d.ts` declares a `PluginState` key and whether
   `register.ts` is `.ts` or `.tsx` (JSX only when it draws).

## Files to create

- `.claude-plugin/plugin.json`: `name` = id, `version` `0.1.0`, a `description` with no trailing
  period, `"types": "./types/index.d.ts"` when it keeps state, and the `author`, `homepage`
  (`https://github.com/penso-technology/claude-plugins/tree/main/plugins/<id>`) and `keywords`
  fields in the shape of the existing manifests. 2-space JSON.
- `hooks/hooks.json`: the one-liner `{ "modules": ["./register.ts"] }` (or `.tsx`).
- `hooks/register.ts`: imports from `'claude-code'` (values) and `import type` from
  `'claude-code'`; a leading `/** Why this mod exists: ... */` comment; SCREAMING_SNAKE
  constants; `atom({ plugin: '<id>', key: '...' } as const, default)` for state; exported pure
  helpers above `export const register: Register = on => { ... }`; every handler is
  `($, e, next) => { ...; return next(e) }`. Any server- or user-supplied text that reaches a
  terminal has control characters stripped, as the existing modules do.
- `types/index.d.ts`: `declare module 'claude-code' { interface PluginState { '<id>': { ... } } }`
  with a `/** */` line per member saying what it is and who resets it. Omit the file and the
  manifest's `types` field when the plugin keeps no state.
- `tsconfig.json`: `{ "extends": "./.claude-plugin/types/tsconfig.json" }`.
- `tests/<id>.test.ts` (`.tsx` when the module is `.tsx`): `import { describe, expect, mock, test } from 'claude-code/testing'` and
  the pure helpers from `'../hooks/register'`; one `describe` per exported helper and one for
  the hook behaviour through `mock`. Copy the arrangement of the neighbouring test file.
- `README.md`: what it does and why the engine does not already (first paragraph), the file or
  state contract if any, a `## Limits` list, and the `## Install` block
  `/plugin install <id> --marketplace penso-technology/claude-plugins`.

## Register it

- Append to `plugins` in `.claude-plugin/marketplace.json`: `name`, `"source": "./plugins/<id>"`,
  and a `description` that ends with a period.
- Add a row to the README's Plugins table: link, what it does, its command or `none; ...`.

## Verify, then stop

Run the verification gate (CLAUDE.md) for the new plugin and report its output; the type-check
step needs one interactive `claude --plugin-dir plugins/<id>` load first, so say so rather than
skipping it silently. Do not commit or push: report "ready for your manual test" per the
local-until-greenlight rule.
