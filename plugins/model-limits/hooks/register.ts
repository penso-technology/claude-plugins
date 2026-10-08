import type { EngineInterface, Register } from 'claude-code'

/**
 * Why this mod exists: the status line's stdin JSON and `$.session.usage()` carry only the
 * `five_hour`, `seven_day` and `spend_limit` windows. The per-model weekly windows (Fable, ...)
 * are only in the usage endpoint's `limits[]` rows, which `/usage` draws as "Current week
 * (<model>)". This mod fetches them and publishes them to a file the status line script reads.
 */

const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'
const OUTPUT_FILE_NAME = '.claude/model-limits.json'
/** The engine's own cadence for re-reading the usage endpoint. */
const MIN_FETCH_INTERVAL_MS = 5 * 60 * 1000

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
  if (typeof percent !== 'number' || typeof scope !== 'object' || scope === null) return false
  const model = (scope as Record<string, unknown>).model
  if (typeof model !== 'object' || model === null) return false
  return typeof (model as Record<string, unknown>).display_name === 'string'
}

const toEpochSeconds = (value: string | number | null): number | null => {
  if (typeof value === 'number') return Math.floor(value)
  if (value === null) return null
  const ms = Date.parse(value)
  return Number.isNaN(ms) ? null : Math.floor(ms / 1000)
}

/** The model-scoped rows of a usage response body, as the status line wants them; `[]` for anything else. */
export const toModelWindows = (body: unknown): ModelWindow[] => {
  if (typeof body !== 'object' || body === null) return []
  const { limits } = body as Record<string, unknown>
  if (!Array.isArray(limits)) return []
  return limits.filter(isModelRow).map(row => ({
    name: row.scope.model.display_name,
    used_percentage: Math.round(row.percent * 10) / 10,
    resets_at: toEpochSeconds(row.resets_at ?? null),
  }))
}

const parseBody = (text: string): unknown => {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/** Fetches the usage endpoint with the session's credential and writes the model windows to the file. */
async function publish($: EngineInterface): Promise<void> {
  const home = await $.env.get('HOME')
  if (home === undefined) return
  const authorization = await $.session.authorize()
  if (authorization === null) return

  const response = await $.http.fetch(USAGE_URL, { auth: authorization.handle })
  if (!response.ok) {
    $.ui.log(`${$.plugin.name}: usage endpoint answered ${response.status}`, { to: 'debug' })
    return
  }

  const published: PublishedLimits = {
    fetched_at: Math.floor((await $.clock.now()) / 1000),
    windows: toModelWindows(parseBody(response.text)),
  }
  await $.fs.write(`${home}/${OUTPUT_FILE_NAME}`, JSON.stringify(published))
}

/** When the endpoint was last read, in `$.clock.now()` milliseconds; starts over on a reload. */
let lastFetchedAt = 0

/** Publishes unless the endpoint was read less than the interval ago. */
async function publishThrottled($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  if (now - lastFetchedAt < MIN_FETCH_INTERVAL_MS) return
  lastFetchedAt = now
  await publish($)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await publishThrottled($)
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('rateLimits')) await publishThrottled($)
    return next(e)
  })
}
