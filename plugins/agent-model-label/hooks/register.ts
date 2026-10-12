import type { AgentSpawnInput, EngineInterface, Register } from 'claude-code'
import type { LearnedModel } from '../types'

const LEARNED = { plugin: 'agent-model-label', key: 'learned' } as const
const INHERIT = 'inherit'
const FORCE_ON = '1'
const BARE_ALIAS = /^[a-z]{1,16}$/
const CONTEXT_SUFFIX = /\[[^\]]*\]$/
const TOAST_DESCRIPTION_LIMIT = 80
const UNPARSED_ID_LIMIT = 32
const CONTROL_AND_FORMAT = /[\p{Cc}\p{Cf}]/gu
/**
 * A first-party id, `claude-<family>-<major>[-<minor>]` or the older
 * `claude-<major>[-<minor>]-<family>`, also after a provider prefix
 * (`us.anthropic.`), and before a `-YYYYMMDD`, `@...`, `[1m]` or `-v1:0` tail.
 * The minor is at most two digits so a date never reads as one.
 */
const FIRST_PARTY_ID =
  /(?:^|\.)claude-(?:([a-z]+)-(\d+)(?:-(\d{1,2}))?|(\d+)(?:-(\d{1,2}))?-([a-z]+))(?=$|-\d{8}|@|\[|-v\d)/

/**
 * What the environment says about subagent models, per the Claude Code docs
 * (https://code.claude.com/docs/en/sub-agents#choose-a-model): a default the
 * call and the definition beat, or a forced model that beats both; forced
 * with nothing configured runs the parent, except the built-in Explore.
 */
export type ModelDefaults =
  | { kind: 'none' }
  | { kind: 'default'; model: string }
  | { kind: 'forced'; model: string }
  | { kind: 'forced-inherit' }

/** The slot of the documented order that decided the model. */
export type DecidedBy = 'fork' | 'forced' | 'call' | 'definition' | 'default' | 'parent'

export type Prediction = { model: string; decidedBy: DecidedBy }

type ParsedId = { family: string; major: string; minor?: string }

/** The family and version of a first-party model id; undefined for an alias or a foreign id. */
export function parse(model: string): ParsedId | undefined {
  const match = FIRST_PARTY_ID.exec(model)
  if (!match) return undefined
  const [, family, major, minor, oldMajor, oldMinor, oldFamily] = match
  if (family !== undefined && major !== undefined) return { family, major, minor }
  if (oldFamily !== undefined && oldMajor !== undefined) return { family: oldFamily, major: oldMajor, minor: oldMinor }
  return undefined
}

/**
 * `claude-fable-5-1` reads `fable 5.1`, `claude-opus-4-20250514` reads `opus 4`,
 * `claude-3-5-haiku-20241022` reads `haiku 3.5`; an alias reads as given, and
 * anything else by its last path segment, cut short, so a provider's ARN never
 * puts an account or project id on the row.
 */
export function label(model: string): string {
  const parsed = parse(model)
  if (parsed) return parsed.minor === undefined ? `${parsed.family} ${parsed.major}` : `${parsed.family} ${parsed.major}.${parsed.minor}`
  if (BARE_ALIAS.test(model)) return model
  const lastSegment = model.slice(model.lastIndexOf('/') + 1)
  return lastSegment.slice(0, UNPARSED_ID_LIMIT)
}

/** Whether the resolved id is what `expected` names: a bare alias its family, an id the same family and version. */
export function matches(expected: string, resolved: string): boolean {
  const alias = expected.replace(CONTEXT_SUFFIX, '')
  if (alias === '') return false
  if (BARE_ALIAS.test(alias)) return parse(resolved)?.family === alias
  return expected === resolved || label(expected) === label(resolved)
}

/** The call's own `model` as a value the order can use: empty is none, `inherit` is the parent. */
function ownModelOf(e: AgentSpawnInput): string | undefined {
  if (e.model === undefined || e.model === '') return undefined
  return e.model === INHERIT ? e.parentModel : e.model
}

/**
 * The model the engine will pick, in the documented order (see ModelDefaults):
 * a forced model, the call's own, the definition's as learned, the configured
 * default, the parent. A fork always inherits.
 */
export function predict(e: AgentSpawnInput, defaults: ModelDefaults, learned?: LearnedModel): Prediction {
  if (e.fork) return { model: e.parentModel, decidedBy: 'fork' }
  if (defaults.kind === 'forced') return { model: defaults.model, decidedBy: 'forced' }
  const own = defaults.kind === 'forced-inherit' ? undefined : ownModelOf(e)
  if (own !== undefined) return { model: own, decidedBy: 'call' }
  if (learned !== undefined) return { model: learned === INHERIT ? e.parentModel : learned, decidedBy: 'definition' }
  if (defaults.kind === 'default') return { model: defaults.model, decidedBy: 'default' }
  return { model: e.parentModel, decidedBy: 'parent' }
}

/** A miss in these slots means the definition decided, which is a fact of the type worth learning. */
function isLearnable(decidedBy: DecidedBy): boolean {
  return decidedBy === 'definition' || decidedBy === 'default' || decidedBy === 'parent'
}

async function readDefaults($: EngineInterface): Promise<ModelDefaults> {
  const [configured, force] = await Promise.all([
    $.env.get('CLAUDE_CODE_SUBAGENT_MODEL'),
    $.env.get('CLAUDE_CODE_SUBAGENT_MODEL_FORCE'),
  ])
  const isForced = force === FORCE_ON
  const model = configured !== undefined && configured !== '' && configured !== INHERIT ? configured : undefined
  if (isForced) return model === undefined ? { kind: 'forced-inherit' } : { kind: 'forced', model }
  return model === undefined ? { kind: 'none' } : { kind: 'default', model }
}

async function readLearned($: EngineInterface, subagentType: string): Promise<LearnedModel | undefined> {
  const { value } = await $.state.get({ ...LEARNED, id: subagentType })
  return value
}

/** Records what the type's definition resolved to; resolves whether that is news. A same-type spawn in parallel writes the same fact. */
async function remember($: EngineInterface, e: AgentSpawnInput, resolved: string): Promise<boolean> {
  const fact: LearnedModel = resolved === e.parentModel ? INHERIT : resolved
  const known = await readLearned($, e.subagentType)
  if (known === fact) return false
  await $.state.set({ ...LEARNED, id: e.subagentType }, fact)
  return true
}

function forToast(description: string): string {
  return description.replace(CONTROL_AND_FORMAT, '').slice(0, TOAST_DESCRIPTION_LIMIT)
}

function labelled(description: string, modelLabel: string): string {
  return description === '' ? `(${modelLabel})` : `${description} (${modelLabel})`
}

export const register: Register = on => {
  /** The corrections this load has toasted, one per fact, so parallel spawns of a type say it once. */
  const toasted = new Set<string>()

  on('agent.spawn', async ($, e, next) => {
    if (e.workflow) return next(e)
    const [defaults, learned] = await Promise.all([readDefaults($), readLearned($, e.subagentType)])
    const { model: expected, decidedBy } = predict(e, defaults, learned)
    const expectedLabel = label(expected)
    if (e.description.endsWith(`(${expectedLabel})`)) return next(e)
    const started = await next({ ...e, description: labelled(e.description, expectedLabel) })
    if (started.deny !== undefined || matches(expected, started.model) || !isLearnable(decidedBy)) return started
    const isNews = await remember($, e, started.model)
    const correction = `${e.subagentType}=${started.model}`
    if (isNews && !toasted.has(correction)) {
      toasted.add(correction)
      $.ui.toast(`${forToast(e.description)}: runs on ${label(started.model)}, not ${expectedLabel}`)
    }
    return started
  })
}
