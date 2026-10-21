import { Duration } from 'effect'
import { describe, expect, it } from 'vitest'

import { loadConfig } from './config.js'

describe('the Channel secret key', () => {
  it('is required in production', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(/CHANNEL_SECRET_KEY/)
  })

  it('is decoded from base64', () => {
    const key = Buffer.alloc(32, 'production-key')

    expect(
      loadConfig({ NODE_ENV: 'production', CHANNEL_SECRET_KEY: key.toString('base64') })
        .channelSecretKey,
    ).toEqual(key)
  })

  it('has the development default of the API outside production', () => {
    expect(loadConfig({}).channelSecretKey).toEqual(Buffer.alloc(32, 'edi-bridge-development-only'))
  })
})

describe('the hosts a Channel may reach at an internal address', () => {
  it('are none by default', () => {
    expect(loadConfig({}).channelAllowedHosts).toEqual([])
  })

  it('list IP addresses, CIDR ranges and host names', () => {
    expect(
      loadConfig({ CHANNEL_ALLOWED_HOSTS: '10.8.0.12,192.168.40.0/24,sftp' }).channelAllowedHosts,
    ).toEqual(['10.8.0.12', '192.168.40.0/24', 'sftp'])
  })

  it('refuse to start with a range of a wrong prefix', () => {
    expect(() => loadConfig({ CHANNEL_ALLOWED_HOSTS: '10.0.0.0/40' })).toThrow(
      /CHANNEL_ALLOWED_HOSTS/,
    )
  })
})

describe('the bound after which a processing Run is stuck', () => {
  it('is 10 minutes by default', () => {
    expect(Duration.toMinutes(loadConfig({}).stuckAfter)).toBe(10)
  })

  it('is read in minutes', () => {
    expect(Duration.toMinutes(loadConfig({ RUN_STUCK_AFTER_MINUTES: '30' }).stuckAfter)).toBe(30)
  })

  it('is positive', () => {
    expect(() => loadConfig({ RUN_STUCK_AFTER_MINUTES: '0' })).toThrow(/RUN_STUCK_AFTER_MINUTES/)
  })
})

describe('the Sentry configuration', () => {
  it('is off without a DSN', () => {
    expect(loadConfig({ SENTRY_ENVIRONMENT: 'production' }).sentry).toBeUndefined()
  })

  it('is off with an empty DSN', () => {
    expect(loadConfig({ SENTRY_DSN: '' }).sentry).toBeUndefined()
  })

  it('samples a tenth of the traces by default', () => {
    expect(loadConfig({ SENTRY_DSN: 'https://key@sentry.example/1' }).sentry).toEqual({
      dsn: 'https://key@sentry.example/1',
      environment: undefined,
      tracesSampleRate: 0.1,
    })
  })

  it('reads the environment and the trace sample rate', () => {
    expect(
      loadConfig({
        SENTRY_DSN: 'https://key@sentry.example/1',
        SENTRY_ENVIRONMENT: 'staging',
        SENTRY_TRACES_SAMPLE_RATE: '0.2',
      }).sentry,
    ).toMatchObject({ environment: 'staging', tracesSampleRate: 0.2 })
  })

  it('samples a tenth of the traces with an empty trace sample rate', () => {
    expect(
      loadConfig({ SENTRY_DSN: 'https://key@sentry.example/1', SENTRY_TRACES_SAMPLE_RATE: '' })
        .sentry,
    ).toMatchObject({ tracesSampleRate: 0.1 })
  })

  it('rejects a trace sample rate above 1', () => {
    expect(() =>
      loadConfig({ SENTRY_DSN: 'https://key@sentry.example/1', SENTRY_TRACES_SAMPLE_RATE: '2' }),
    ).toThrow(/SENTRY_TRACES_SAMPLE_RATE/)
  })

  it('rejects a DSN that is not a URL', () => {
    expect(() => loadConfig({ SENTRY_DSN: 'not a dsn' })).toThrow(/SENTRY_DSN/)
  })
})
