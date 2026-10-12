/**
 * The model each agent type's own definition resolved to, one member per
 * `subagentType`, learned from a spawn whose predicted model missed: the
 * definition's `model` frontmatter is the one input an `agent.spawn` hook
 * cannot read. The member is a model id, or `inherit` when the definition
 * follows the parent, so a later `/model` switch does not stale it.
 */
export type LearnedModel = string

declare module 'claude-code' {
  interface PluginState {
    'agent-model-label': { learned: StateFamily<LearnedModel> }
  }
}
