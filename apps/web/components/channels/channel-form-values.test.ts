import { describe, expect, it } from 'vitest'

import { type Channel, type ChannelKind, channelKinds } from '@edi-bridge/contracts'
import { createChannel, toChannel } from '@edi-bridge/mocks'

import {
  type ChannelFormValues,
  toFormValues,
  validateChannelUpdate,
  validateNewChannel,
} from './channel-form-values'

const blank = toFormValues()

const sftp: ChannelFormValues = {
  ...blank,
  kind: 'sftp-inbound',
  name: 'Kieler Kontor SFTP inbox',
  host: 'sftp.kieler-kontor.example',
  username: 'nordwind',
  remotePath: '/outbox',
  credential: 's3cret',
}

function existing<Kind extends ChannelKind>(
  kind: Kind,
  overrides: Partial<Extract<Channel, Kind>> = {},
) {
  // SAFETY: toChannel keeps the kind that createChannel built the record for.
  return { ...toChannel(createChannel(kind), 'http://localhost'), ...overrides } as Extract<
    Channel,
    Kind
  >
}

describe('toFormValues', () => {
  it('starts a new Channel as inbound SFTP polling every minute on port 22', () => {
    expect(blank).toMatchObject({
      kind: 'sftp-inbound',
      port: '22',
      pollingIntervalMinutes: '1',
      credential: '',
    })
  })

  it('never fills a secret from a saved Channel', () => {
    const channel = existing(channelKinds[0])

    expect(toFormValues(channel)).toMatchObject({ credential: '', host: channel.host })
  })
})

describe('validateNewChannel', () => {
  it('turns inbound SFTP values into the API input', () => {
    expect(validateNewChannel({ ...sftp, pollingIntervalMinutes: '5' })).toEqual({
      input: {
        type: 'sftp',
        direction: 'inbound',
        name: 'Kieler Kontor SFTP inbox',
        tradingPartnerId: null,
        host: 'sftp.kieler-kontor.example',
        port: 22,
        username: 'nordwind',
        remotePath: '/outbox',
        authentication: 'password',
        credential: 's3cret',
        pollingIntervalMinutes: 5,
      },
    })
  })

  it('leaves the polling interval out of outbound SFTP', () => {
    const result = validateNewChannel({ ...sftp, kind: 'sftp-outbound' })

    expect(result).toHaveProperty('input')
    expect(result).not.toHaveProperty('input.pollingIntervalMinutes')
  })

  it('reports every invalid field at once', () => {
    expect(
      validateNewChannel({
        ...sftp,
        name: ' ',
        host: 'sftp example',
        port: '',
        remotePath: 'outbox',
        credential: '',
        pollingIntervalMinutes: '0',
      }),
    ).toEqual({
      errors: {
        name: 'required',
        host: 'format',
        port: 'range',
        remotePath: 'format',
        credential: 'required',
        pollingIntervalMinutes: 'range',
      },
    })
  })

  it('creates a webhook Channel with only its rate limit', () => {
    expect(validateNewChannel({ ...blank, kind: 'webhook-inbound', name: 'ERP webhook' })).toEqual({
      input: {
        type: 'webhook',
        direction: 'inbound',
        name: 'ERP webhook',
        tradingPartnerId: null,
        rateLimitPerMinute: 60,
      },
    })
  })

  it('requires the Authorization header value only when it is sent', () => {
    const http = { ...blank, kind: 'http-outbound', name: 'ERP', url: 'https://erp.example/edi' }

    expect(validateNewChannel({ ...http, kind: 'http-outbound' })).toEqual({
      errors: { authorization: 'required' },
    })
    expect(
      validateNewChannel({ ...http, kind: 'http-outbound', sendAuthorization: false }),
    ).toMatchObject({ input: { authorization: null } })
  })

  it('rejects a URL that is not HTTP', () => {
    expect(
      validateNewChannel({
        ...blank,
        kind: 'http-outbound',
        name: 'ERP',
        url: 'ftp://erp.example',
        sendAuthorization: false,
      }),
    ).toEqual({ errors: { url: 'format' } })
  })
})

describe('validateChannelUpdate', () => {
  it('keeps the stored credential when the field is left blank', () => {
    const channel = existing(channelKinds[0], { authentication: 'password' })
    const result = validateChannelUpdate({ ...toFormValues(channel), name: 'Renamed' }, channel)

    expect(result).toMatchObject({ input: { name: 'Renamed', credential: undefined } })
  })

  it('requires a new credential when the authentication method changes', () => {
    const channel = existing(channelKinds[0], { authentication: 'password' })

    expect(
      validateChannelUpdate({ ...toFormValues(channel), authentication: 'privateKey' }, channel),
    ).toEqual({ errors: { credential: 'required' } })
  })

  it('keeps, replaces or removes the Authorization header of an HTTP Channel', () => {
    const channel = existing(channelKinds[3], { authorization: { lastFour: null } })
    const values = toFormValues(channel)

    expect(validateChannelUpdate(values, channel)).toMatchObject({
      input: { authorization: undefined },
    })
    expect(
      validateChannelUpdate({ ...values, authorization: 'Bearer new' }, channel),
    ).toMatchObject({ input: { authorization: 'Bearer new' } })
    expect(validateChannelUpdate({ ...values, sendAuthorization: false }, channel)).toMatchObject({
      input: { authorization: null },
    })
  })

  it('requires an Authorization value when the header is added', () => {
    const channel = existing(channelKinds[3], { authorization: null })

    expect(
      validateChannelUpdate({ ...toFormValues(channel), sendAuthorization: true }, channel),
    ).toEqual({ errors: { authorization: 'required' } })
  })
})
