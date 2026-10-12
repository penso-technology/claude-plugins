/**
 * The model id each agent type's own definition resolved to, keyed by
 * `subagentType`: learned from a spawn whose predicted model missed, since a
 * definition's `model` frontmatter is the one input an `agent.spawn` hook
 * cannot read.
 */
export type LearnedModels = Record<string, string>

declare module 'claude-code' {
  interface PluginState {
    'agent-model-label': { learned: LearnedModels }
  }
}
