# claude-plugins

A marketplace of [Claude Code](https://claude.com/claude-code) plugins: live UI mods and hooks.

## Install

From the prompt of a terminal Claude Code session:

```
/plugin install context-bar --marketplace penso-technology/claude-plugins
```

Answer `y` to add the marketplace the first time, then pick a scope (`user` loads it in every
session). The plugin is active at once and in each session started afterwards. Later versions
arrive with `claude plugin update context-bar` followed by `/reload-plugins`.

## Plugins

| Plugin | What it does | Command |
|--------|--------------|---------|
| [`context-bar`](plugins/context-bar) | Draws the context window as a stacked bar above the prompt, one colour per `/context` category, with a legend of the used categories. | `/context-bar` toggles it |

## Layout

```
.claude-plugin/marketplace.json   the marketplace: one entry per plugin, source a relative path
plugins/<name>/                   one plugin per folder
  .claude-plugin/plugin.json      manifest (name, version, description, author, types)
  hooks/hooks.json                { "modules": ["./register.tsx"] }
  hooks/register.tsx              the hooks module
  types/index.d.ts                the plugin's $.state contract, when it keeps state
  tests/*.test.tsx                run by `claude plugin test`
```

## Adding a plugin

1. Create `plugins/<name>/` with the files above; `name` in `plugin.json` is the install name.
2. Add an entry to `.claude-plugin/marketplace.json` with `"source": "./plugins/<name>"`.
3. `claude plugin validate .` reads the marketplace, the manifest and the hooks module in one run;
   `claude plugin test plugins/<name>` runs its tests.
4. Add the plugin to the table above.
5. Bump `version` in `plugin.json` on every change you want installers to receive.

## Developing

Run a plugin from its folder without installing it:

```
claude --plugin-dir plugins/<name>
```

The folder is watched: saving a file hot-reloads the hooks module in that session.

## License

[MIT](LICENSE), Penso Technology S.r.l.
