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
