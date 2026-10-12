# agent-model-label

Appends the model a subagent runs on to its description, so the agent list above the prompt
names it on the same line:

```
○ general-purpose  Compiling privacy facts report (fable 5.1)
○ general-purpose  Listing Kotlin projects (haiku)
```

The row text is the Agent call's `description`, which an `agent.spawn` hook can rewrite. The
engine resolves the model beneath that hook, after the description has gone past, so the plugin
predicts it from what the spawn carries, in the documented order: `CLAUDE_CODE_SUBAGENT_MODEL`
when `CLAUDE_CODE_SUBAGENT_MODEL_FORCE` is `1`, then the call's own `model`, then the agent
definition's, then `CLAUDE_CODE_SUBAGENT_MODEL`, then the parent's model. A fork always
inherits.

A full id is shortened to family and version (`claude-fable-5-1` reads `fable 5.1`); an alias
passed on the call is shown as passed (`haiku`), since the resolved id is only known afterwards.

The agent definition's `model` frontmatter is the one input the hook cannot read. When the
resolved model differs from the prediction, a toast names the real one and the plugin remembers
that agent type's model in session state, so every later spawn of the type is labelled right.
The memory is per session and survives a hot reload.

The `● main` row is the session itself, not a spawn, and stays unlabelled. A workflow agent's
description is not rewritable and is left alone.

## Install

```
/plugin install agent-model-label --marketplace penso-technology/claude-plugins
```
