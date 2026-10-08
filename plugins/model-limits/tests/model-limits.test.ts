import { describe, expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { toModelWindows } from '../hooks/register'

const FABLE_RESET = '2026-10-15T07:00:00Z'
const FABLE_RESET_EPOCH = 1_792_047_600

const USAGE_BODY = {
  five_hour: { utilization: 23.5, resets_at: '2026-10-08T22:00:00Z' },
  seven_day: { utilization: 41.2, resets_at: '2026-10-13T07:00:00Z' },
  limits: [
    { kind: 'session', group: 'session', percent: 23.5, resets_at: '2026-10-08T22:00:00Z', scope: null },
    { kind: 'weekly_all', group: 'weekly', percent: 41.2, resets_at: '2026-10-13T07:00:00Z', scope: null },
    { kind: 'weekly_scoped', group: 'weekly', percent: 12.34, resets_at: FABLE_RESET, scope: { model: { display_name: 'Fable' } } },
    { kind: 'weekly_scoped', group: 'weekly', percent: 7, resets_at: null, scope: { model: { display_name: 'Sonnet' } } },
  ],
}

describe('toModelWindows', () => {
  test('keeps the model-scoped rows, rounds to a decimal, converts the reset to epoch seconds', async () => {
    expect(toModelWindows(USAGE_BODY)).toEqual([
      { name: 'Fable', used_percentage: 12.3, resets_at: FABLE_RESET_EPOCH },
      { name: 'Sonnet', used_percentage: 7, resets_at: null },
    ])
  })

  test('answers nothing for a body without rows', async () => {
    expect(toModelWindows(undefined)).toEqual([])
    expect(toModelWindows({})).toEqual([])
    expect(toModelWindows({ limits: 'nope' })).toEqual([])
    expect(toModelWindows({ limits: [{ percent: 'x', scope: { model: { display_name: 'Fable' } } }] })).toEqual([])
  })
})

const START = { cwd: '/tmp/project', surface: 'terminal' as const, isInteractive: true }
const MEASURE = { context: { window: 200_000 }, rateLimits: [], changed: ['rateLimits' as const] }

type Written = { path: string; text: string }

/** The engine's floor: a logged-in session, a usage endpoint answering the fixture, a home directory. */
const AUTHORIZED = { handle: 'h-1', kind: 'bearer' as const }
const NOW_MS = 1_760_000_000_000

type Floor = { status?: number; authorization?: typeof AUTHORIZED | null }

const floor = (on: On, written: Written[], { status = 200, authorization = AUTHORIZED }: Floor = {}) => {
  on('clock.now', async () => ({ value: NOW_MS }))
  on('session.start', async ($, e) => ({ cwd: e.cwd }))
  on('session.measure', async ($, e) => ({ changed: e.changed }))
  on('env.get', async ($, e, next) => (e.name === 'HOME' ? { value: '/Users/me' } : next(e)))
  on('session.authorize', async () => ({ value: authorization }))
  on('http.fetch', async () => ({
    value: { status, ok: status >= 200 && status < 300, headers: {}, text: JSON.stringify(USAGE_BODY) },
  }))
  on('fs.write', async ($, e) => {
    written.push({ path: e.path, text: e.text })
    return { value: undefined }
  })
}

describe('publishing', () => {
  test('writes the model windows under the home directory at session start', async ($, on) => {
    const written: Written[] = []
    floor(on, written)
    await $.session.start(START)
    expect(written.length).toBe(1)
    expect(written[0]?.path).toBe('/Users/me/.claude/model-limits.json')
    const content = JSON.parse(written[0]?.text ?? '{}')
    expect(content.fetched_at).toBe(NOW_MS / 1000)
    expect(content.windows).toEqual(toModelWindows(USAGE_BODY))
  })

  test('a rate-limit change within the interval does not read the endpoint again', async ($, on) => {
    const written: Written[] = []
    floor(on, written)
    await $.session.start(START)
    await $.session.measure(MEASURE)
    expect(written.length).toBe(1)
  })

  test('a measurement without a rate-limit change writes nothing', async ($, on) => {
    const written: Written[] = []
    floor(on, written)
    await $.session.measure({ ...MEASURE, changed: ['context'] })
    expect(written.length).toBe(0)
  })

  test('a failed fetch writes nothing', async ($, on) => {
    const written: Written[] = []
    floor(on, written, { status: 401 })
    await $.session.start(START)
    expect(written.length).toBe(0)
  })

  test('a session without a first-party credential writes nothing', async ($, on) => {
    const written: Written[] = []
    floor(on, written, { authorization: null })
    await $.session.start(START)
    expect(written.length).toBe(0)
  })
})
