import type { On, SessionContextBreakdown } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'

import { allocate, formatTokens, toSnapshot } from '../hooks/register'

describe('formatTokens', () => {
  test('prints as /context does', async () => {
    expect(formatTokens(512)).toBe('512')
    expect(formatTokens(9_500)).toBe('9.5k')
    expect(formatTokens(84_200)).toBe('84k')
    expect(formatTokens(1_000_000)).toBe('1.0M')
  })
})

describe('allocate', () => {
  const seg = (tokens: number) => ({ name: 'x', tokens, color: 'text', kind: 'used' as const })

  test('widths sum to the bar width', async () => {
    const widths = allocate([seg(3), seg(3), seg(3)], 10)
    expect(widths.reduce((a, b) => a + b, 0)).toBe(10)
  })

  test('a tiny segment still gets one cell', async () => {
    const widths = allocate([seg(1), seg(999)], 20)
    expect(widths[0]).toBe(1)
    expect(widths[1]).toBe(19)
  })

  test('zero width or zero tokens draws nothing', async () => {
    expect(allocate([seg(1)], 0)).toEqual([0])
    expect(allocate([seg(0)], 10)).toEqual([0])
  })
})

const BREAKDOWN: SessionContextBreakdown = {
      categories: [
        { name: 'Free space', tokens: 100, color: 'inactive', isDeferred: false, kind: 'free' },
        { name: 'Autocompact buffer', tokens: 20, color: 'subtle', isDeferred: false, kind: 'buffer' },
        { name: 'Deferred tools', tokens: 5, color: 'text', isDeferred: true, kind: 'deferred' },
        { name: 'Messages', tokens: 80, color: 'promptBorder', isDeferred: false, kind: 'used' },
      ],
      totalTokens: 80,
      maxTokens: 200,
      rawMaxTokens: 200,
      autocompactSource: 'auto',
      percentage: 40,
      gridRows: [],
      model: 'test',
      memoryFiles: [],
      mcpTools: [],
      agents: [],
      isAutoCompactEnabled: true,
      apiUsage: null,
}

describe('toSnapshot', () => {
  test('drops deferred rows and orders used, buffer, free', async () => {
    const shot = toSnapshot(BREAKDOWN)
    expect(shot.segments.map(s => s.kind)).toEqual(['used', 'buffer', 'free'])
    expect(shot.maxTokens).toBe(200)
  })
})

const RUN = {
  command: 'context-bar',
  args: '',
  origin: { kind: 'composer' as const },
  presentation: { isFullscreen: false, columns: 100 },
}

const BAND = {
  plugin: 'context-bar',
  component: 'AbovePrompt' as const,
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 80, scroll: { offset: 0, bodyRows: 9 }, view: {} },
}

/** The engine's floor: a usage reading with the fake breakdown, and an empty band. */
const floor = (on: On) => {
  on('session.usage', async () => ({
    value: { startedAt: 0, context: { window: 200, breakdown: BREAKDOWN }, rateLimits: [] },
  }))
  on('ui.render', { component: 'AbovePrompt' }, async ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
}

describe('/context-bar', () => {
  test('toggles the band and reports it', async ($, on) => {
    floor(on)
    expect((await $.command.run(RUN)).text).toBe('Context bar hidden.')
    expect((await $.command.run(RUN)).text).toBe('Context bar shown.')
  })

  test('yields the band while nothing has been measured', async ($, on) => {
    floor(on)
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ ...BAND, surface })
      expect(await ui.find({ text: /%/ })).toBeUndefined()
      await ui.unmount()
    }
  })

  test('draws the bar and legend once measured, and yields to a survey', async ($, on) => {
    floor(on)
    await $.command.run(RUN)
    await $.command.run(RUN)
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ ...BAND, surface })
      expect(await ui.find({ text: /40% 80\/200/ })).toBeDefined()
      expect(await ui.find({ text: /Messages 80/ })).toBeDefined()
      expect(await ui.find({ text: /Deferred/ })).toBeUndefined()
      const bar = await ui.find({ type: 'Text', text: /^█+$/ })
      expect(bar?.props.color).toBe('promptBorder')
      await ui.redraw({ ...BAND.props, hasSurvey: true })
      expect(await ui.find({ text: /%/ })).toBeUndefined()
      await ui.unmount()
    }
  })

  test('hidden band draws nothing even when measured', async ($, on) => {
    floor(on)
    await $.command.run(RUN)
    const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
    expect(await ui.find({ text: /%/ })).toBeUndefined()
    await ui.unmount()
  })
})
