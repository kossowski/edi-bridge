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
