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
