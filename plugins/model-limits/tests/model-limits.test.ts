import { describe, expect, mock, test } from 'claude-code/testing'
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

const scoped = (name: string, percent: unknown, resets_at?: unknown) => ({
  percent,
  ...(resets_at === undefined ? {} : { resets_at }),
  scope: { model: { display_name: name } },
})

describe('toModelWindows', () => {
  test('keeps the model-scoped rows, rounds to a decimal, converts the reset to epoch seconds', async () => {
    expect(toModelWindows(USAGE_BODY)).toEqual([
      { name: 'Fable', used_percentage: 12.3, resets_at: FABLE_RESET_EPOCH },
      { name: 'Sonnet', used_percentage: 7, resets_at: null },
    ])
  })

  test('a numeric reset is seconds already, an unparsable or absent one is null', async () => {
    const body = { limits: [scoped('A', 1, 1_792_047_600.9), scoped('B', 1, 'garbage'), scoped('C', 1)] }
    expect(toModelWindows(body)?.map(w => w.resets_at)).toEqual([FABLE_RESET_EPOCH, null, null])
  })

  test('strips control characters from the name (an escape sequence becomes inert text) and caps its length', async () => {
    const body = { limits: [scoped('\u001b]52;c;Zm9v\u0007Fa\u001fble\n', 1), scoped('x'.repeat(100), 1)] }
    expect(toModelWindows(body)?.map(w => w.name)).toEqual([']52;c;Zm9vFable', 'x'.repeat(64)])
  })

  test('drops a row whose percent is not a finite number in range', async () => {
    const body = { limits: [scoped('A', 1e308), scoped('B', -1), scoped('C', '50'), scoped('D', 50)] }
    expect(toModelWindows(body)?.map(w => w.name)).toEqual(['D'])
  })

  test('answers an empty list for a limits array without model rows', async () => {
    expect(toModelWindows({ limits: [] })).toEqual([])
    expect(toModelWindows({ limits: [{ percent: 'x', scope: { model: { display_name: 'Fable' } } }] })).toEqual([])
  })

  test('answers null for a body without a limits array', async () => {
    expect(toModelWindows(undefined)).toBe(null)
    expect(toModelWindows({})).toBe(null)
    expect(toModelWindows({ limits: 'nope' })).toBe(null)
  })
})

const START = { cwd: '/tmp/project', surface: 'terminal' as const, isInteractive: true }
const MEASURE = { context: { window: 200_000 }, rateLimits: [], changed: ['rateLimits' as const] }
const AUTHORIZED = { handle: 'h-1', kind: 'bearer' as const }
const NOW_MS = 1_760_000_000_000

type Written = { path: string; text: string }

/** The engine beneath the plugin: a clock, a home directory, a credential, the usage endpoint, the file system. */
type World = {
  written: Written[]
  fetches: number
  status: number
  body: string
  authorization: typeof AUTHORIZED | null
  fetchRejects: boolean
}

const floor = (on: On, overrides: Partial<World> = {}) => {
  const world: World = {
    written: [],
    fetches: 0,
    status: 200,
    body: JSON.stringify(USAGE_BODY),
    authorization: AUTHORIZED,
    fetchRejects: false,
    ...overrides,
  }
  const clock = mock.clock(on, { now: NOW_MS })
  mock.env(on, { HOME: '/Users/me' })
  on('session.start', async ($, e) => ({ cwd: e.cwd }))
  on('session.measure', async ($, e) => ({ changed: e.changed }))
  on('session.authorize', async () => ({ value: world.authorization }))
  on('http.fetch', async () => {
    world.fetches += 1
    if (world.fetchRejects) throw new Error('offline')
    return { value: { status: world.status, ok: world.status >= 200 && world.status < 300, headers: {}, text: world.body } }
  })
  on('fs.write', async ($, e) => {
    world.written.push({ path: e.path, text: e.text })
    return { value: undefined }
  })
  return { world, clock }
}

describe('publishing', () => {
  test('writes the model windows under the home directory at session start, without holding the start', async ($, on) => {
    const { world, clock } = floor(on)
    await $.session.start(START)
    expect(world.written.length).toBe(0)
    await clock.settle()
    expect(world.written.length).toBe(1)
    expect(world.written[0]?.path).toBe('/Users/me/.claude/model-limits.json')
    const content = JSON.parse(world.written[0]?.text ?? '{}')
    expect(content.fetched_at).toBe(NOW_MS / 1000)
    expect(content.windows).toEqual(toModelWindows(USAGE_BODY))
  })

  test('a rate-limit change within the interval does not read the endpoint again', async ($, on) => {
    const { world, clock } = floor(on)
    await $.session.start(START)
    await clock.settle()
    await $.session.measure(MEASURE)
    await clock.settle()
    expect(world.fetches).toBe(1)
    expect(world.written.length).toBe(1)
  })

  test('a rate-limit change past the interval reads it again', async ($, on) => {
    const { world, clock } = floor(on)
    await $.session.start(START)
    await clock.settle()
    await clock.advance(5 * 60 * 1000)
    await $.session.measure(MEASURE)
    await clock.settle()
    expect(world.fetches).toBe(2)
    expect(world.written.length).toBe(2)
  })

  test('events arriving while a publish is under way share it', async ($, on) => {
    const { world, clock } = floor(on)
    await $.session.start(START)
    await $.session.measure(MEASURE)
    await clock.settle()
    expect(world.fetches).toBe(1)
    expect(world.written.length).toBe(1)
  })

  test('a measurement without a rate-limit change writes nothing', async ($, on) => {
    const { world, clock } = floor(on)
    await $.session.measure({ ...MEASURE, changed: ['context'] })
    await clock.settle()
    expect(world.fetches).toBe(0)
  })

  test('a failed fetch writes nothing and does not use up the interval', async ($, on) => {
    const { world, clock } = floor(on, { status: 401 })
    await $.session.start(START)
    await clock.settle()
    expect(world.written.length).toBe(0)
    world.status = 200
    await $.session.measure(MEASURE)
    await clock.settle()
    expect(world.fetches).toBe(2)
    expect(world.written.length).toBe(1)
  })

  test('a 200 whose body is not the usage shape leaves the file alone', async ($, on) => {
    const { world, clock } = floor(on, { body: '<html>captive portal</html>' })
    await $.session.start(START)
    await clock.settle()
    expect(world.written.length).toBe(0)
  })

  test('a rejecting fetch is logged, not thrown: the start resolves and nothing is written', async ($, on) => {
    const { world, clock } = floor(on, { fetchRejects: true })
    await $.session.start(START)
    await clock.settle()
    expect(world.fetches).toBe(1)
    expect(world.written.length).toBe(0)
  })

  test('a session without a first-party credential writes nothing', async ($, on) => {
    const { world, clock } = floor(on, { authorization: null })
    await $.session.start(START)
    await clock.settle()
    expect(world.fetches).toBe(0)
    expect(world.written.length).toBe(0)
  })
})
