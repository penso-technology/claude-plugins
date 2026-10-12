import { describe, expect, mock, test } from 'claude-code/testing'
import type { AgentSpawnInput, On } from 'claude-code'
import { label, matches, predict } from '../hooks/register'

const PARENT = 'claude-fable-5-1'
const HAIKU = 'claude-haiku-4-5-20251001'
const SONNET = 'claude-sonnet-5-5'

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

/** Stands beneath the mod as the engine does: records the description handed down and resolves the model. */
function engineResolving(on: On, model: string): string[] {
  const seen: string[] = []
  on('agent.spawn', (_$, e) => {
    seen.push(e.description)
    return { model, agentId: 'agent_1' }
  })
  return seen
}

function toastsOf(on: On): string[] {
  const toasts: string[] = []
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  return toasts
}

describe('the line', () => {
  test('names the parent model when nothing else assigns one', async ($, on) => {
    mock.env(on, {})
    const seen = engineResolving(on, PARENT)
    const toasts = toastsOf(on)
    await $.agent.spawn(spawnOf())
    expect(seen).toEqual(['Compiling report (fable 5.1)'])
    expect(toasts).toEqual([])
  })

  test('names the per-call model as the call spelled it', async ($, on) => {
    mock.env(on, {})
    const seen = engineResolving(on, HAIKU)
    const toasts = toastsOf(on)
    await $.agent.spawn(spawnOf({ model: 'haiku' }))
    expect(seen).toEqual(['Compiling report (haiku)'])
    expect(toasts).toEqual([])
  })

  test('a fork inherits whatever the call asked for', async ($, on) => {
    mock.env(on, {})
    const seen = engineResolving(on, PARENT)
    await $.agent.spawn(spawnOf({ fork: true, model: 'haiku' }))
    expect(seen).toEqual(['Compiling report (fable 5.1)'])
  })

  test('names the configured default, and the forced one over a per-call model', async ($, on) => {
    mock.env(on, { CLAUDE_CODE_SUBAGENT_MODEL: SONNET, CLAUDE_CODE_SUBAGENT_MODEL_FORCE: '1' })
    const seen = engineResolving(on, SONNET)
    await $.agent.spawn(spawnOf())
    await $.agent.spawn(spawnOf({ model: 'haiku' }))
    expect(seen).toEqual(['Compiling report (sonnet 5.5)', 'Compiling report (sonnet 5.5)'])
  })

  test('a default of inherit is as good as none', async ($, on) => {
    mock.env(on, { CLAUDE_CODE_SUBAGENT_MODEL: 'inherit' })
    const seen = engineResolving(on, PARENT)
    await $.agent.spawn(spawnOf())
    expect(seen).toEqual(['Compiling report (fable 5.1)'])
  })

  test('learns a definition model from the first miss and says so once', async ($, on) => {
    mock.env(on, {})
    const seen = engineResolving(on, HAIKU)
    const toasts = toastsOf(on)
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

  test('a denied spawn passes through untouched', async ($, on) => {
    mock.env(on, {})
    on('agent.spawn', () => ({ deny: 'no agents here' }))
    const toasts = toastsOf(on)
    const answer = await $.agent.spawn(spawnOf())
    expect(answer).toEqual({ deny: 'no agents here' })
    expect(toasts).toEqual([])
  })

  test('a workflow agent keeps its description', async ($, on) => {
    mock.env(on, {})
    const seen = engineResolving(on, PARENT)
    await $.agent.spawn(spawnOf({ workflow: { runId: 'wf_abc123', agentIndex: 1 } }))
    expect(seen).toEqual(['Compiling report'])
  })
})

describe('label', () => {
  test('reads family and version off an id, either order', async () => {
    expect(label('claude-fable-5-1')).toBe('fable 5.1')
    expect(label('claude-opus-4-1-20250805')).toBe('opus 4.1')
    expect(label('claude-3-5-haiku-20241022')).toBe('haiku 3.5')
    expect(label('claude-opus-5-5[1m]')).toBe('opus 5.5')
  })

  test('leaves an alias or an unknown id as given', async () => {
    expect(label('haiku')).toBe('haiku')
    expect(label('arn:aws:bedrock:us-east-1::inference-profile/x')).toBe('arn:aws:bedrock:us-east-1::inference-profile/x')
  })
})

describe('predict and matches', () => {
  test('follows the documented order', async () => {
    const none = { isForced: false }
    expect(predict(spawnOf(), none, {})).toBe(PARENT)
    expect(predict(spawnOf(), { configured: SONNET, isForced: false }, {})).toBe(SONNET)
    expect(predict(spawnOf(), { configured: SONNET, isForced: false }, { 'general-purpose': HAIKU })).toBe(HAIKU)
    expect(predict(spawnOf({ model: 'opus' }), { configured: SONNET, isForced: false }, { 'general-purpose': HAIKU })).toBe('opus')
    expect(predict(spawnOf({ model: 'opus' }), { configured: SONNET, isForced: true }, {})).toBe(SONNET)
    expect(predict(spawnOf({ model: 'opus' }), { isForced: true }, {})).toBe(PARENT)
    expect(predict(spawnOf({ fork: true, model: 'opus' }), { configured: SONNET, isForced: true }, {})).toBe(PARENT)
  })

  test('an alias matches its family, an id itself, and nothing else', async () => {
    expect(matches('opus', 'claude-opus-5-5[1m]')).toBe(true)
    expect(matches(PARENT, PARENT)).toBe(true)
    expect(matches('haiku', PARENT)).toBe(false)
    expect(matches(SONNET, PARENT)).toBe(false)
  })
})
