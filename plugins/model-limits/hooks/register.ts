import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

/**
 * Why this mod exists: the status line's stdin JSON and `$.session.usage()` carry only the
 * `five_hour`, `seven_day` and `spend_limit` windows. The per-model weekly windows (Fable, ...)
 * are only in the usage endpoint's `limits[]` rows, which `/usage` draws as "Current week
 * (<model>)". This mod fetches them and publishes them to a file the status line script reads.
 */

const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'
/** Under $HOME whatever CLAUDE_CONFIG_DIR says: the path is a wire contract with the status line script. */
const OUTPUT_PATH_UNDER_HOME = '.claude/model-limits.json'
/** The engine's own cadence for re-reading the usage endpoint. */
const MIN_PUBLISH_INTERVAL_MS = 5 * 60 * 1000
/** The model name is server-supplied free text that ends up on a terminal through jq and printf. */
const MAX_NAME_LENGTH = 64
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/g
const MAX_PERCENT = 1000

/**
 * When the file was last written, in `$.clock.now()` milliseconds. Session state, not a module
 * variable, so a hot reload does not read the endpoint again.
 */
const lastPublishedAt = atom({ plugin: 'model-limits', key: 'lastPublishedAt' } as const, 0)

/**
 * The publish under way, so events arriving meanwhile share it instead of starting another.
 * A module variable on purpose: a hot reload drops the old environment's promise with it.
 */
let inFlight: Promise<void> | undefined

/** One per-model weekly window, with `resets_at` in epoch seconds like the status line's windows. */
export type ModelWindow = {
  name: string
  used_percentage: number
  resets_at: number | null
}

/** The file's whole content. */
export type PublishedLimits = {
  fetched_at: number
  windows: ModelWindow[]
}

/** A `limits[]` row scoped to one model, as the endpoint reports it. */
type ModelRow = {
  percent: number
  resets_at?: string | number | null
  scope: { model: { display_name: string } }
}

const isModelRow = (row: unknown): row is ModelRow => {
  if (typeof row !== 'object' || row === null) return false
  const { percent, scope } = row as Record<string, unknown>
  if (typeof percent !== 'number' || !Number.isFinite(percent) || percent < 0 || percent > MAX_PERCENT) return false
  if (typeof scope !== 'object' || scope === null) return false
  const model = (scope as Record<string, unknown>).model
  if (typeof model !== 'object' || model === null) return false
  return typeof (model as Record<string, unknown>).display_name === 'string'
}

/** A numeric `resets_at` is already in seconds: the engine's own projection multiplies it by 1000 for a Date. */
const toEpochSeconds = (value: ModelRow['resets_at']): number | null => {
  if (typeof value === 'number') return Math.floor(value)
  if (value === null || value === undefined) return null
  const ms = Date.parse(value)
  return Number.isNaN(ms) ? null : Math.floor(ms / 1000)
}

const toName = (displayName: string): string =>
  displayName.replace(CONTROL_CHARACTERS, '').slice(0, MAX_NAME_LENGTH)

/**
 * The model-scoped rows of a usage response body, as the status line wants them; `null` when
 * the body carries no `limits` array, so a captive portal or a schema change publishes nothing.
 */
export const toModelWindows = (body: unknown): ModelWindow[] | null => {
  if (typeof body !== 'object' || body === null) return null
  const { limits } = body as Record<string, unknown>
  if (!Array.isArray(limits)) return null
  return limits.filter(isModelRow).map(row => ({
    name: toName(row.scope.model.display_name),
    used_percentage: Math.round(row.percent * 10) / 10,
    resets_at: toEpochSeconds(row.resets_at),
  }))
}

const parseBody = (text: string): unknown => {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/** Reads the usage endpoint with the session's credential; `null` when there is nothing to publish. */
async function readModelWindows($: EngineInterface): Promise<ModelWindow[] | null> {
  const authorization = await $.session.authorize()
  if (authorization === null) return null

  const response = await $.http.fetch(USAGE_URL, { auth: authorization.handle })
  if (!response.ok) {
    $.ui.log(`${$.plugin.name}: usage endpoint answered ${response.status}`, { to: 'debug' })
    return null
  }
  const windows = toModelWindows(parseBody(response.text))
  if (windows === null) $.ui.log(`${$.plugin.name}: usage endpoint answered no limits array`, { to: 'debug' })
  return windows
}

/** Writes the model windows to the file under the home directory; says whether it did. */
async function publish($: EngineInterface, now: number): Promise<boolean> {
  const home = await $.env.get('HOME')
  if (home === undefined) return false
  const windows = await readModelWindows($)
  if (windows === null) return false

  const published: PublishedLimits = { fetched_at: Math.floor(now / 1000), windows }
  await $.fs.write(`${home}/${OUTPUT_PATH_UNDER_HOME}`, JSON.stringify(published))
  return true
}

/** Publishes unless the file was written less than the interval ago; a failed attempt does not count. */
async function publishIfDue($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  if (now - (await read($, lastPublishedAt)) < MIN_PUBLISH_INTERVAL_MS) return
  if (await publish($, now)) await update($, lastPublishedAt, () => now)
}

/** Starts a publish nothing waits for: one at a time, failures logged, never thrown into a hook. */
function publishDetached($: EngineInterface): void {
  if (inFlight !== undefined) return
  inFlight = publishIfDue($)
    .catch(error => $.ui.log(`${$.plugin.name}: publish failed: ${String(error)}`, { to: 'debug' }))
    .finally(() => {
      inFlight = undefined
    })
}

export const register: Register = on => {
  on('session.start', ($, e, next) => {
    publishDetached($)
    return next(e)
  })

  on('session.measure', ($, e, next) => {
    if (e.changed.includes('rateLimits')) publishDetached($)
    return next(e)
  })
}
