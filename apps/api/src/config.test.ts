import { describe, expect, it } from 'vitest'

import { loadConfig } from './config.js'

const production = {
  NODE_ENV: 'production',
  BETTER_AUTH_URL: 'https://edi-bridge.example.com',
  BETTER_AUTH_SECRET: 'production-secret-that-is-at-least-32-characters',
  CHANNEL_SECRET_KEY: Buffer.alloc(32, 'production-key').toString('base64'),
}

describe('the Channel secret key', () => {
  it('is required in production', () => {
    expect(() => loadConfig({ ...production, CHANNEL_SECRET_KEY: undefined })).toThrow(
      /CHANNEL_SECRET_KEY/,
    )
  })

  it('has 32 bytes', () => {
    const shortKey = Buffer.alloc(16, 'short').toString('base64')

    expect(() => loadConfig({ ...production, CHANNEL_SECRET_KEY: shortKey })).toThrow(
      /CHANNEL_SECRET_KEY/,
    )
  })

  it('is decoded from base64', () => {
    expect(loadConfig(production).channels.secretKey).toEqual(Buffer.alloc(32, 'production-key'))
  })

  it('has a development default outside production', () => {
    expect(loadConfig({}).channels.secretKey).toHaveLength(32)
  })
})

describe('the hosts a Channel may reach at a blocked address', () => {
  it('are none by default', () => {
    expect(loadConfig(production).channels.allowedHosts).toEqual([])
  })

  it('are none with an empty value', () => {
    expect(loadConfig({ ...production, CHANNEL_ALLOWED_HOSTS: '' }).channels.allowedHosts).toEqual(
      [],
    )
  })

  it('list IP addresses, CIDR ranges and host names', () => {
    expect(
      loadConfig({
        ...production,
        CHANNEL_ALLOWED_HOSTS: '10.8.0.12, 192.168.40.0/24,fd00::/8 , sftp.partner.internal',
      }).channels.allowedHosts,
    ).toEqual(['10.8.0.12', '192.168.40.0/24', 'fd00::/8', 'sftp.partner.internal'])
  })

  it.each(['10.0.0.0/33', 'fd00::/129', '10.0.0.0/', '10.0.0.0/8x', 'sftp partner'])(
    'refuse to start with the entry %s',
    (entry) => {
      expect(() => loadConfig({ ...production, CHANNEL_ALLOWED_HOSTS: entry })).toThrow(
        /CHANNEL_ALLOWED_HOSTS/,
      )
    },
  )
})

describe('the public API URL', () => {
  it('is the /api path of the public origin in production', () => {
    expect(loadConfig(production).channels.apiPublicUrl).toBe('https://edi-bridge.example.com/api')
  })

  it('is the API itself in development', () => {
    expect(loadConfig({}).channels.apiPublicUrl).toBe('http://localhost:3001')
  })

  it('follows API_PUBLIC_URL when it is set', () => {
    const apiPublicUrl = 'https://api.edi-bridge.example.com'

    expect(loadConfig({ ...production, API_PUBLIC_URL: apiPublicUrl }).channels.apiPublicUrl).toBe(
      apiPublicUrl,
    )
  })
})

describe('the AI model', () => {
  it('drafts with the model of AI_MODEL when an Anthropic API key is set', () => {
    expect(
      loadConfig({ ANTHROPIC_API_KEY: 'sk-ant-test', AI_MODEL: 'claude-opus-5-5' }).aiModel,
    ).toMatchObject({ modelId: 'claude-opus-5-5' })
  })

  it('is missing without an Anthropic API key', () => {
    expect(loadConfig(production).aiModel).toBeNull()
  })
})

describe('Sentry', () => {
  const dsn = 'https://public-key@sentry.example.com/1'

  it('is off without SENTRY_DSN, in production too', () => {
    expect(loadConfig(production).sentry).toBeNull()
  })

  it('is off with an empty SENTRY_DSN', () => {
    expect(loadConfig({ SENTRY_DSN: '', SENTRY_TRACES_SAMPLE_RATE: '' }).sentry).toBeNull()
  })

  it('samples a tenth of the traces by default', () => {
    expect(loadConfig({ SENTRY_DSN: dsn }).sentry).toEqual({
      dsn,
      environment: undefined,
      tracesSampleRate: 0.1,
    })
  })

  it('reports to the environment and samples at the rate that are set', () => {
    expect(
      loadConfig({
        SENTRY_DSN: dsn,
        SENTRY_ENVIRONMENT: 'staging',
        SENTRY_TRACES_SAMPLE_RATE: '0.2',
      }).sentry,
    ).toEqual({ dsn, environment: 'staging', tracesSampleRate: 0.2 })
  })

  it('refuses a sample rate outside 0 to 1', () => {
    expect(() => loadConfig({ SENTRY_DSN: dsn, SENTRY_TRACES_SAMPLE_RATE: '20' })).toThrow(
      /SENTRY_TRACES_SAMPLE_RATE/,
    )
  })

  it('refuses a DSN that is no URL', () => {
    expect(() => loadConfig({ SENTRY_DSN: 'public-key' })).toThrow(/SENTRY_DSN/)
  })
})
