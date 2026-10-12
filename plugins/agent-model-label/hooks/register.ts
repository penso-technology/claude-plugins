import type { AgentSpawnInput, EngineInterface, Register } from 'claude-code'
import type { LearnedModels } from '../types'

const LEARNED = { plugin: 'agent-model-label', key: 'learned' } as const
const INHERIT = 'inherit'
const FORCE_ON = '1'
const FAMILY_THEN_VERSION = /^claude-([a-z]+)-(\d+)-(\d+)/
const VERSION_THEN_FAMILY = /^claude-(\d+)-(\d+)-([a-z]+)/
const REMEMBER_ATTEMPTS = 3

/** What the environment says about subagent models: the configured default and whether it is forced onto every spawn. */
export type ModelDefaults = { configured?: string; isForced: boolean }

/** `claude-fable-5-1` reads `fable 5.1`, `claude-3-5-haiku-20241022` reads `haiku 3.5`; an alias or an unknown id reads as given. */
export function label(model: string): string {
  const familyFirst = FAMILY_THEN_VERSION.exec(model)
  if (familyFirst) return `${familyFirst[1]} ${familyFirst[2]}.${familyFirst[3]}`
  const versionFirst = VERSION_THEN_FAMILY.exec(model)
  if (versionFirst) return `${versionFirst[3]} ${versionFirst[1]}.${versionFirst[2]}`
  return model
}

/**
 * The model the engine will pick, in the documented order: a forced default
 * over everything, then the call's own, the definition's (as learned), the
 * configured default, the parent's. A fork always inherits.
 */
export function predict(e: AgentSpawnInput, defaults: ModelDefaults, learned: LearnedModels): string {
  if (e.fork) return e.parentModel
  if (defaults.isForced) return defaults.configured ?? e.parentModel
  return e.model ?? learned[e.subagentType] ?? defaults.configured ?? e.parentModel
}

/** Whether the resolved id is what `expected` names: the same id, the same family and version, or the family an alias names. */
export function matches(expected: string, resolved: string): boolean {
  return expected === resolved || label(expected) === label(resolved) || resolved.includes(expected)
}

async function readDefaults($: EngineInterface): Promise<ModelDefaults> {
  const [configured, force] = await Promise.all([
    $.env.get('CLAUDE_CODE_SUBAGENT_MODEL'),
    $.env.get('CLAUDE_CODE_SUBAGENT_MODEL_FORCE'),
  ])
  const isConfigured = configured !== undefined && configured !== '' && configured !== INHERIT
  return { configured: isConfigured ? configured : undefined, isForced: force === FORCE_ON }
}

async function readLearned($: EngineInterface): Promise<LearnedModels> {
  const { value } = await $.state.get(LEARNED)
  return value ?? {}
}

/** Records the model a type's definition resolved to; a concurrent spawn's write is kept by retrying on its version. */
async function remember($: EngineInterface, subagentType: string, model: string): Promise<void> {
  for (let attempt = 0; attempt < REMEMBER_ATTEMPTS; attempt++) {
    const held = await $.state.get(LEARNED)
    const learned = held.value ?? {}
    if (learned[subagentType] === model) return
    const written = await $.state.set(LEARNED, { ...learned, [subagentType]: model }, { ifVersion: held.version })
    if (written.isSet) return
  }
}

function isDecidedByDefinition(e: AgentSpawnInput, defaults: ModelDefaults): boolean {
  return !e.fork && e.model === undefined && !defaults.isForced
}

export const register: Register = on => {
  on('agent.spawn', async ($, e, next) => {
    if (e.workflow) return next(e)
    const [defaults, learned] = await Promise.all([readDefaults($), readLearned($)])
    const expected = predict(e, defaults, learned)
    const shown = label(expected)
    const started = await next({ ...e, description: `${e.description} (${shown})` })
    if (started.deny !== undefined || matches(expected, started.model)) return started
    $.ui.toast(`${e.description}: runs on ${label(started.model)}, not ${shown}`)
    if (isDecidedByDefinition(e, defaults)) await remember($, e.subagentType, started.model)
    return started
  }).catch(($, e, next) => next(e))
}
