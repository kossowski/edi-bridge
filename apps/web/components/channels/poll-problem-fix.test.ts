import { describe, expect, it } from 'vitest'

import { type Channel, channelTestFailureReasons } from '@edi-bridge/contracts'
import { createChannel, toChannel } from '@edi-bridge/mocks'

import { isInboundSftp, pollProblemFix, pollProblemOf } from './poll-problem-fix'

const apiUrl = 'http://api.test'

const pollProblem = { reason: 'loginRejected', since: '2026-10-20T07:15:00.000Z' } as const

function inboundSftp(problem: typeof pollProblem | null): Channel {
  const record = createChannel({ type: 'sftp', direction: 'inbound' })

  return toChannel(isInboundSftp(record) ? { ...record, pollProblem: problem } : record, apiUrl)
}

describe('pollProblemOf', () => {
  it('returns the stored poll problem of an inbound SFTP Channel', () => {
    expect(pollProblemOf(inboundSftp(pollProblem))).toEqual(pollProblem)
  })

  it('is null for an inbound SFTP Channel without a poll problem', () => {
    expect(pollProblemOf(inboundSftp(null))).toBeNull()
  })

  it('is null for a Channel that is never polled', () => {
    const webhook = toChannel(createChannel({ type: 'webhook', direction: 'inbound' }), apiUrl)
    const outbound = toChannel(createChannel({ type: 'sftp', direction: 'outbound' }), apiUrl)

    expect(pollProblemOf(webhook)).toBeNull()
    expect(pollProblemOf(outbound)).toBeNull()
  })
})

describe('pollProblemFix', () => {
  const id = '10000000-0000-4000-8000-000000000001'

  it('sends a host key mismatch to the host key of the Channel', () => {
    expect(pollProblemFix(id, 'hostKeyMismatch')).toEqual({
      target: 'hostKey',
      href: `/channels/${id}#channel-host-key`,
    })
  })

  it('sends a rejected login to the credentials', () => {
    expect(pollProblemFix(id, 'loginRejected')).toEqual({
      target: 'credentials',
      href: `/channels/${id}/edit`,
    })
  })

  it('sends a blocked address to the server address in the settings', () => {
    expect(pollProblemFix(id, 'addressBlocked')).toEqual({
      target: 'address',
      href: `/channels/${id}/edit`,
    })
  })

  it('sends every other reason to the settings of the Channel', () => {
    const others = channelTestFailureReasons.filter(
      (reason) =>
        reason !== 'hostKeyMismatch' && reason !== 'loginRejected' && reason !== 'addressBlocked',
    )

    for (const reason of others) {
      expect(pollProblemFix(id, reason)).toEqual({
        target: 'settings',
        href: `/channels/${id}/edit`,
      })
    }
  })
})
