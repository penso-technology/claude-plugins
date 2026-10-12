import { describe, expect, mock, test } from 'claude-code/testing'
import type { AgentSpawnInput, On } from 'claude-code'
import { label, matches, parse, predict } from '../hooks/register'

const PARENT = 'claude-fable-5-1'
const HAIKU = 'claude-haiku-4-5-20251001'
const SONNET = 'claude-sonnet-5-5'
const OPUS = 'claude-opus-5-5'
const NONE = { kind: 'none' } as const

const spawnOf = (over: Partial<AgentSpawnInput> = {}): AgentSpawnInput => ({
  tool_use_id: 'toolu_1',
  prompt: 'Read README.md.',
  description: 'Compiling report',
  subagentType: 'general-purpose',
  provider: { plugin: 'engine', tier: 'core' },
  parentModel: PARENT,
  background: false,
  fork: false,
  ...over,
})

/** Stands beneath the plugin as the engine does: records the description handed down and resolves the model, by type when given a map. */
function recordDescriptionsResolving(on: On, model: string | Record<string, string>): string[] {
  const seen: string[] = []
  on('agent.spawn', (_$, e) => {
    seen.push(e.description)
    const resolved = typeof model === 'string' ? model : (model[e.subagentType] ?? PARENT)
    return { model: resolved, agentId: 'agent_1' }
  })
  return seen
}

function recordToasts(on: On): string[] {
  const toasts: string[] = []
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  return toasts
}

describe('the row', () => {
  test('names the parent model when nothing else assigns one', async ($, on) => {
    mock.env(on, {})
    const seen = recordDescriptionsResolving(on, PARENT)
    const toasts = recordToasts(on)
    await $.agent.spawn(spawnOf())
    expect(seen).toEqual(['Compiling report (fable 5.1)'])
    expect(toasts).toEqual([])
  })

  test('names the per-call model as the call spelled it', async ($, on) => {
    mock.env(on, {})
    const seen = recordDescriptionsResolving(on, HAIKU)
    const toasts = recordToasts(on)
    await $.agent.spawn(spawnOf({ model: 'haiku' }))
    expect(seen).toEqual(['Compiling report (haiku)'])
    expect(toasts).toEqual([])
  })

  test('a per-call model the engine did not honour is neither toasted nor learned', async ($, on) => {
    mock.env(on, {})
    const seen = recordDescriptionsResolving(on, PARENT)
    const toasts = recordToasts(on)
    await $.agent.spawn(spawnOf({ model: 'haiku' }))
    await $.agent.spawn(spawnOf({ model: 'haiku' }))
    expect(seen).toEqual(['Compiling report (haiku)', 'Compiling report (haiku)'])
    expect(toasts).toEqual([])
  })

  test('a fork ignores the per-call model and inherits', async ($, on) => {
    mock.env(on, {})
    const seen = recordDescriptionsResolving(on, PARENT)
    await $.agent.spawn(spawnOf({ fork: true, model: 'haiku' }))
    expect(seen).toEqual(['Compiling report (fable 5.1)'])
  })

  test('a per-call model of inherit or empty reads as none', async ($, on) => {
    mock.env(on, {})
    const seen = recordDescriptionsResolving(on, PARENT)
    const toasts = recordToasts(on)
    await $.agent.spawn(spawnOf({ model: 'inherit' }))
    await $.agent.spawn(spawnOf({ model: '' }))
    expect(seen).toEqual(['Compiling report (fable 5.1)', 'Compiling report (fable 5.1)'])
    expect(toasts).toEqual([])
  })

  test('names the configured default under a per-call model of none', async ($, on) => {
    mock.env(on, { CLAUDE_CODE_SUBAGENT_MODEL: SONNET })
    const seen = recordDescriptionsResolving(on, { 'general-purpose': SONNET, scout: HAIKU })
    await $.agent.spawn(spawnOf())
    await $.agent.spawn(spawnOf({ model: 'haiku', subagentType: 'scout' }))
    expect(seen).toEqual(['Compiling report (sonnet 5.5)', 'Compiling report (haiku)'])
  })

  test('a forced default beats the per-call model', async ($, on) => {
    mock.env(on, { CLAUDE_CODE_SUBAGENT_MODEL: SONNET, CLAUDE_CODE_SUBAGENT_MODEL_FORCE: '1' })
    const seen = recordDescriptionsResolving(on, SONNET)
    await $.agent.spawn(spawnOf({ model: 'haiku' }))
    expect(seen).toEqual(['Compiling report (sonnet 5.5)'])
  })

  test('force alone runs the parent, and learns the built-in exception', async ($, on) => {
    mock.env(on, { CLAUDE_CODE_SUBAGENT_MODEL_FORCE: '1' })
    const seen = recordDescriptionsResolving(on, { Explore: OPUS })
    const toasts = recordToasts(on)
    await $.agent.spawn(spawnOf({ model: 'haiku' }))
    await $.agent.spawn(spawnOf({ subagentType: 'Explore' }))
    await $.agent.spawn(spawnOf({ subagentType: 'Explore' }))
    expect(seen).toEqual([
      'Compiling report (fable 5.1)',
      'Compiling report (fable 5.1)',
      'Compiling report (opus 5.5)',
    ])
    expect(toasts).toEqual(['Compiling report: runs on opus 5.5, not fable 5.1'])
  })

  test('a default of inherit or empty, and a force flag not 1, are as good as none', async ($, on) => {
    mock.env(on, { CLAUDE_CODE_SUBAGENT_MODEL: '', CLAUDE_CODE_SUBAGENT_MODEL_FORCE: 'true' })
    const seen = recordDescriptionsResolving(on, HAIKU)
    await $.agent.spawn(spawnOf({ model: 'haiku' }))
    expect(seen).toEqual(['Compiling report (haiku)'])
  })

  test('learns a definition model from the first miss and says so once', async ($, on) => {
    mock.env(on, {})
    const seen = recordDescriptionsResolving(on, HAIKU)
    const toasts = recordToasts(on)
    await $.agent.spawn(spawnOf({ subagentType: 'scout' }))
    await $.agent.spawn(spawnOf({ subagentType: 'scout' }))
    await $.agent.spawn(spawnOf({ subagentType: 'scout' }))
    expect(seen).toEqual([
      'Compiling report (fable 5.1)',
      'Compiling report (haiku 4.5)',
      'Compiling report (haiku 4.5)',
    ])
    expect(toasts).toEqual(['Compiling report: runs on haiku 4.5, not fable 5.1'])
  })

  test('a learned definition that follows the parent survives a model switch', async ($, on) => {
    mock.env(on, { CLAUDE_CODE_SUBAGENT_MODEL: SONNET })
    const seen = recordDescriptionsResolving(on, { scout: PARENT })
    await $.agent.spawn(spawnOf({ subagentType: 'scout' }))
    await $.agent.spawn(spawnOf({ subagentType: 'scout', parentModel: OPUS }))
    expect(seen).toEqual(['Compiling report (sonnet 5.5)', 'Compiling report (opus 5.5)'])
  })

  test('parallel spawns each learn their own type and toast each fact once', async ($, on) => {
    mock.env(on, {})
    const seen = recordDescriptionsResolving(on, { scout: HAIKU, reviewer: SONNET })
    const toasts = recordToasts(on)
    await Promise.all([
      $.agent.spawn(spawnOf({ subagentType: 'scout', description: 'Scouting' })),
      $.agent.spawn(spawnOf({ subagentType: 'scout', description: 'Scouting again' })),
      $.agent.spawn(spawnOf({ subagentType: 'reviewer', description: 'Reviewing' })),
    ])
    await $.agent.spawn(spawnOf({ subagentType: 'scout', description: 'Scouting later' }))
    await $.agent.spawn(spawnOf({ subagentType: 'reviewer', description: 'Reviewing later' }))
    expect(seen.slice(3)).toEqual(['Scouting later (haiku 4.5)', 'Reviewing later (sonnet 5.5)'])
    expect(toasts.length).toBe(2)
    expect(toasts).toContain('Scouting: runs on haiku 4.5, not fable 5.1')
    expect(toasts).toContain('Reviewing: runs on sonnet 5.5, not fable 5.1')
  })

  test('a description already labelled, or empty, is handled', async ($, on) => {
    mock.env(on, {})
    const seen = recordDescriptionsResolving(on, PARENT)
    await $.agent.spawn(spawnOf({ description: 'Compiling report (fable 5.1)' }))
    await $.agent.spawn(spawnOf({ description: '' }))
    expect(seen).toEqual(['Compiling report (fable 5.1)', '(fable 5.1)'])
  })

  test('the toast carries no control characters and a cut description', async ($, on) => {
    mock.env(on, {})
    recordDescriptionsResolving(on, HAIKU)
    const toasts = recordToasts(on)
    const long = 'x'.repeat(100)
    await $.agent.spawn(spawnOf({ subagentType: 'scout', description: `Esc\u001b[31m${long}` }))
    expect(toasts).toEqual([`Esc[31m${'x'.repeat(73)}: runs on haiku 4.5, not fable 5.1`])
  })

  test('a denied spawn passes through untouched', async ($, on) => {
    mock.env(on, {})
    on('agent.spawn', () => ({ deny: 'no agents here' }))
    const toasts = recordToasts(on)
    const answer = await $.agent.spawn(spawnOf())
    expect(answer).toEqual({ deny: 'no agents here' })
    expect(toasts).toEqual([])
  })

  test('a workflow agent keeps its description', async ($, on) => {
    mock.env(on, {})
    const seen = recordDescriptionsResolving(on, PARENT)
    await $.agent.spawn(spawnOf({ workflow: { runId: 'wf_abc123', agentIndex: 1 } }))
    expect(seen).toEqual(['Compiling report'])
  })
})

describe('parse and label', () => {
  test('reads family and version off an id, either order, under any tail', async () => {
    expect(label('claude-fable-5-1')).toBe('fable 5.1')
    expect(label('claude-opus-4-1-20250805')).toBe('opus 4.1')
    expect(label('claude-opus-4-20250514')).toBe('opus 4')
    expect(label('claude-sonnet-4-20250514')).toBe('sonnet 4')
    expect(label('claude-fable-5')).toBe('fable 5')
    expect(label('claude-3-5-haiku-20241022')).toBe('haiku 3.5')
    expect(label('claude-3-opus-20240229')).toBe('opus 3')
    expect(label('claude-opus-5-5[1m]')).toBe('opus 5.5')
    expect(label('us.anthropic.claude-sonnet-4-5-20250929-v1:0')).toBe('sonnet 4.5')
    expect(label('claude-sonnet-4-5@20250929')).toBe('sonnet 4.5')
  })

  test('leaves an alias as given and cuts a foreign id to its last segment', async () => {
    expect(label('haiku')).toBe('haiku')
    expect(parse('haiku')).toBeUndefined()
    expect(label('arn:aws:bedrock:us-east-1:123456789012:inference-profile/my-profile')).toBe('my-profile')
    expect(label('a'.repeat(50))).toBe('a'.repeat(32))
  })
})

describe('predict and matches', () => {
  test('follows the documented order and names the slot', async () => {
    const withDefault = { kind: 'default', model: SONNET } as const
    expect(predict(spawnOf(), NONE)).toEqual({ model: PARENT, decidedBy: 'parent' })
    expect(predict(spawnOf(), withDefault)).toEqual({ model: SONNET, decidedBy: 'default' })
    expect(predict(spawnOf(), withDefault, HAIKU)).toEqual({ model: HAIKU, decidedBy: 'definition' })
    expect(predict(spawnOf(), withDefault, 'inherit')).toEqual({ model: PARENT, decidedBy: 'definition' })
    expect(predict(spawnOf({ model: 'opus' }), withDefault, HAIKU)).toEqual({ model: 'opus', decidedBy: 'call' })
    expect(predict(spawnOf({ model: 'opus' }), { kind: 'forced', model: SONNET })).toEqual({ model: SONNET, decidedBy: 'forced' })
    expect(predict(spawnOf({ model: 'opus' }), { kind: 'forced-inherit' })).toEqual({ model: PARENT, decidedBy: 'parent' })
    expect(predict(spawnOf({ model: 'opus' }), { kind: 'forced-inherit' }, OPUS)).toEqual({ model: OPUS, decidedBy: 'definition' })
    expect(predict(spawnOf({ fork: true, model: 'opus' }), { kind: 'forced', model: SONNET })).toEqual({ model: PARENT, decidedBy: 'fork' })
  })

  test('an alias matches its family, an id the same family and version, nothing else', async () => {
    expect(matches('opus', 'claude-opus-5-5[1m]')).toBe(true)
    expect(matches('opus[1m]', 'claude-opus-5-5[1m]')).toBe(true)
    expect(matches(PARENT, PARENT)).toBe(true)
    expect(matches(SONNET, 'claude-sonnet-5-5-20260101')).toBe(true)
    expect(matches('haiku', PARENT)).toBe(false)
    expect(matches(SONNET, PARENT)).toBe(false)
    expect(matches('claude-sonnet-5', SONNET)).toBe(false)
    expect(matches('', PARENT)).toBe(false)
    expect(matches('a', 'claude-fable-5-1')).toBe(false)
  })
})
