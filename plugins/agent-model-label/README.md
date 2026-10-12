# agent-model-label

Appends the model a subagent runs on to its description, so the agent list above the prompt
names it on the same line:

```
○ general-purpose  Compiling privacy facts report (fable 5.1)
○ general-purpose  Listing Kotlin projects (haiku)
```

The row text is the Agent call's `description`, which an `agent.spawn` hook can rewrite. The
engine resolves the model beneath that hook, after the description has gone past, so the row
is a prediction made from what the spawn carries, in the order the
[Claude Code docs](https://code.claude.com/docs/en/sub-agents#choose-a-model) state:
`CLAUDE_CODE_SUBAGENT_MODEL` when `CLAUDE_CODE_SUBAGENT_MODEL_FORCE` is `1` (the force flag
alone runs every subagent on the parent's model); then the call's own `model`; then the agent
definition's; then `CLAUDE_CODE_SUBAGENT_MODEL`; then the parent's model. A fork always inherits.

A full id is shortened to family and version (`claude-fable-5-1` reads `fable 5.1`,
`claude-opus-4-20250514` reads `opus 4`); an alias passed on the call is shown as passed
(`haiku`), since the resolved id is only known afterwards; an id of another shape, such as a
provider's ARN, is cut to its last path segment.

## What the plugin learns

The agent definition's `model` frontmatter is the one input the hook cannot read. When the
resolved model differs from the prediction and the definition's slot decided it, a toast names
the real model and the plugin remembers that agent type's model in session state, so every
later spawn of the type is labelled right; a definition whose model changes mid-session costs
one wrong row and one toast, then corrects. A definition that follows the parent is remembered
as such, so a `/model` switch does not stale it. The memory is per session and survives a hot
reload. The same path covers the built-in Explore subagent under the force flag alone, which
the docs exempt from inheriting.

## Limits

- The `● main` row is the session itself, not a spawn, and stays unlabelled.
- A per-call `model` the engine did not honour (blocked by `availableModels`, say) keeps the
  call's label on the row; Claude Code shows its own warning for that, and the plugin adds none.
- A plugin ordered beneath this one that answers `agent.spawn` with a `model` of its own
  decides after the row is written, so its choice shows as a toast, not on the row.
- A workflow agent's description is not rewritable and is left alone.

## Install

```
/plugin install agent-model-label --marketplace penso-technology/claude-plugins
```
