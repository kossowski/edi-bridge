import { describe, expect, it } from 'vitest'

import { aiModelFromEnv } from './ai-model.js'

describe('aiModelFromEnv', () => {
  it('drafts with Claude Sonnet 5.5 unless AI_MODEL names another model', () => {
    expect(aiModelFromEnv({ ANTHROPIC_API_KEY: 'sk-ant-test' })).toMatchObject({
      provider: 'anthropic.messages',
      modelId: 'claude-sonnet-5-5',
    })

    expect(
      aiModelFromEnv({ ANTHROPIC_API_KEY: 'sk-ant-test', AI_MODEL: 'claude-opus-5-5' }),
    ).toMatchObject({ modelId: 'claude-opus-5-5' })
  })

  it('has no model without an API key', () => {
    expect(aiModelFromEnv({})).toBeNull()
    expect(aiModelFromEnv({ ANTHROPIC_API_KEY: '' })).toBeNull()
  })

  it('rejects a malformed API key instead of drafting without a model', () => {
    expect(() => aiModelFromEnv({ ANTHROPIC_API_KEY: 'sk-ant-test\n' })).toThrow(
      'ANTHROPIC_API_KEY',
    )
    expect(() => aiModelFromEnv({ ANTHROPIC_API_KEY: ' ' })).toThrow('ANTHROPIC_API_KEY')
  })
})
