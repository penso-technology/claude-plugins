# claude-plugins

A marketplace of [Claude Code](https://claude.com/claude-code) plugins: live UI mods and hooks.

## Install

From the prompt of a terminal Claude Code session, with `<plugin>` one of the names in the table
below:

```
/plugin install <plugin> --marketplace penso-technology/claude-plugins
```

Answer `y` to add the marketplace the first time, then pick a scope (`user` loads it in every
session). The plugin is active at once and in each session started afterwards. Later versions
arrive with `claude plugin update <plugin>` followed by `/reload-plugins`.

## Plugins

| Plugin | What it does | Command |
|--------|--------------|---------|
| [`context-bar`](plugins/context-bar) | Draws the context window as a stacked bar above the prompt, one colour per `/context` category, with a legend of the used categories. | `/context-bar` toggles it |
| [`model-limits`](plugins/model-limits) | Publishes the per-model weekly rate-limit windows (`Current week (Fable)` on `/usage`), which the status line's stdin lacks, to `~/.claude/model-limits.json` for a status line script to draw. | none; it writes the file at session start and after a turn whose rate-limit reading moved |
| [`agent-model-label`](plugins/agent-model-label) | Appends the model a subagent runs on to its description, so the agent list above the prompt reads `Compiling report (fable 5.1)`; a definition's own model is learned from the first spawn and toasted. | none; every spawn is labelled |

## Layout

```
.claude-plugin/marketplace.json   the marketplace: one entry per plugin, source a relative path
plugins/<name>/                   one plugin per folder
  .claude-plugin/plugin.json      manifest (name, version, description, author, types)
  hooks/hooks.json                { "modules": ["./register.tsx"] }
  hooks/register.tsx              the hooks module (.ts where it draws nothing)
  types/index.d.ts                the plugin's $.state contract, when it keeps state
  tests/*.test.tsx                run by `claude plugin test` (.ts where the module is .ts)
  tsconfig.json                   { "extends": "./.claude-plugin/types/tsconfig.json" }
  README.md                       what it does, its contract if any, its limits, its install line
```

## Adding a plugin

1. Create `plugins/<name>/` with the files above; `name` in `plugin.json` is the install name.
2. Add an entry to `.claude-plugin/marketplace.json` with `"source": "./plugins/<name>"`.
3. `claude plugin validate .` checks the marketplace and the manifests; it does not load the
   hooks module, so a module that does not compile still passes it. `claude plugin test
   plugins/<name>` loads the module and runs its tests, and is what catches that.
4. `npx -p typescript tsc --noEmit -p plugins/<name>` type-checks the module. It needs the
   engine-written `plugins/<name>/.claude-plugin/types/` (see Developing), so run it after the
   plugin has been loaded once.
5. Add the plugin to the table above.
6. Bump `version` in `plugin.json` on every change you want installers to receive.

## Developing

Run a plugin from its folder without installing it:

```
claude --plugin-dir plugins/<name>
```

The folder is watched: saving a file hot-reloads the hooks module in that session. That first
interactive load also writes `plugins/<name>/.claude-plugin/types/` (gitignored), the `claude-code`
type declarations and the `tsconfig.json` the plugin's own extends; `claude plugin test` and a
headless `claude -p` load do not write it, so editor type information and the `tsc` step both wait
for one such load.

A Claude Code session opened in this repo gets the hooks in `.claude/settings.json`: at the end of
a turn that edited a plugin, they check the plugin's id across its folder, manifest, marketplace
entry, state key and table row, run `claude plugin validate .`, and run the tests of the plugins
the session touched. `/new-plugin <name>` scaffolds a plugin in the shape above and registers it;
`/release <version>` cuts a release to `main`. CLAUDE.md states what else the tooling assumes.

## License

[MIT](LICENSE), Penso Technology S.r.l.
