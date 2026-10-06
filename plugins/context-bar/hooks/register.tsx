import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionContextBreakdown } from 'claude-code'

import type { Segment, Snapshot } from '../types'


const COMMAND = 'context-bar'

const isHidden = atom({ plugin: 'context-bar', key: 'isHidden' } as const, false)
const snapshot = atom({ plugin: 'context-bar', key: 'snapshot' } as const, null)

/** `84k`, `9.5k`, `1.2M`: the figure as /context prints it beside a row. */
export const formatTokens = (tokens: number): string => {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`
  if (tokens >= 10_000) return `${Math.round(tokens / 1000)}k`
  if (tokens >= 1_000) return `${(tokens / 1000).toFixed(1)}k`
  return `${tokens}`
}

/**
 * Splits `width` cells over the segments in proportion to their tokens, by
 * largest remainder, so the widths sum to `width` exactly. A segment with
 * tokens shows at least one cell when there is a cell to take from a wider one.
 */
export const allocate = (segments: readonly Segment[], width: number): number[] => {
  const total = segments.reduce((sum, s) => sum + Math.max(0, s.tokens), 0)
  if (width <= 0 || total <= 0) return segments.map(() => 0)

  const exact = segments.map(s => (Math.max(0, s.tokens) / total) * width)
  const widths = exact.map(Math.floor)
  let left = width - widths.reduce((a, b) => a + b, 0)
  const byRemainder = exact
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((a, b) => b.remainder - a.remainder)
  for (const { index } of byRemainder) {
    if (left <= 0) break
    widths[index] = (widths[index] ?? 0) + 1
    left -= 1
  }

  for (let i = 0; i < segments.length; i += 1) {
    if ((segments[i]?.tokens ?? 0) <= 0 || (widths[i] ?? 0) > 0) continue
    let widest = -1
    for (let j = 0; j < widths.length; j += 1) {
      if ((widths[j] ?? 0) > 1 && (widest < 0 || (widths[j] ?? 0) > (widths[widest] ?? 0))) widest = j
    }
    if (widest < 0) break
    widths[widest] = (widths[widest] ?? 0) - 1
    widths[i] = 1
  }

  return widths
}

/** The band's data from a breakdown: deferred rows out, drawing order used, buffer, free. */
export const toSnapshot = (breakdown: SessionContextBreakdown): Snapshot => {
  const order: Record<Segment['kind'], number> = { used: 0, buffer: 1, free: 2 }
  const segments: Segment[] = breakdown.categories
    .filter(row => row.kind !== 'deferred')
    .map(row => ({
      name: row.name,
      tokens: row.tokens,
      color: row.color,
      kind: row.kind as Segment['kind'],
    }))
    .sort((a, b) => order[a.kind] - order[b.kind])

  return {
    segments,
    totalTokens: breakdown.totalTokens,
    maxTokens: breakdown.rawMaxTokens,
    percentage: breakdown.percentage,
    model: breakdown.model,
  }
}

const GLYPH: Record<Segment['kind'], string> = { used: '█', buffer: '▒', free: '░' }

/** Reads the window as /context estimates it (no token-count requests) into the snapshot. */
async function refresh($: EngineInterface): Promise<void> {
  const usage = await $.session.usage({ breakdown: 'summary' })
  const breakdown = usage.context.breakdown
  if (!breakdown) return
  await update($, snapshot, () => toSnapshot(breakdown))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: COMMAND,
      description: 'Show or hide the context-window bar above the prompt',
    })
    void refresh($)

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    await refresh($)

    return next(e)
  })

  on('command.run', { command: COMMAND }, async $ => {
    const hidden = !(await read($, isHidden))
    await update($, isHidden, () => hidden)
    if (!hidden) await refresh($)

    return { text: hidden ? 'Context bar hidden.' : 'Context bar shown.' }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const shot = await read($, snapshot)
    if (e.props.hasSurvey || shot === null || (await read($, isHidden))) {
      return next(e)
    }

    const { Box, Text } = $.ui.resolve(e)
    const label = ` ${shot.percentage}% ${formatTokens(shot.totalTokens)}/${formatTokens(shot.maxTokens)}`
    const width = Math.max(10, e.props.bodyColumns - label.length)
    const widths = allocate(shot.segments, width)
    const legend = shot.segments.filter(s => s.kind === 'used' && s.tokens > 0)

    return (
      <Box flexDirection="column">
        <Box>
          {shot.segments.map((segment, i) =>
            (widths[i] ?? 0) > 0 ? (
              <Text color={segment.color} dimColor={segment.kind === 'free'}>
                {GLYPH[segment.kind].repeat(widths[i] ?? 0)}
              </Text>
            ) : null,
          )}
          <Text dimColor>{label}</Text>
        </Box>
        <Box>
          {legend.map(segment => (
            <Text>
              <Text color={segment.color}>■ </Text>
              <Text dimColor>
                {segment.name} {formatTokens(segment.tokens)}{'  '}
              </Text>
            </Text>
          ))}
        </Box>
      </Box>
    )
  })
}
