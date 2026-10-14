import { describe, expect, it } from 'vitest'

import { maxWorkspaceNameLength } from '@edi-bridge/contracts'
import { seedInvites } from '@edi-bridge/mocks'

import {
  inviteStatus,
  sameWorkspaceName,
  validateInviteForm,
  validateWorkspaceForm,
} from './operator'

const invite = seedInvites[0]!

describe('validateWorkspaceForm', () => {
  it('trims the name', () => {
    expect(validateWorkspaceForm({ name: '  Ostsee Feinkost AG ', seed: true })).toEqual({
      input: { name: 'Ostsee Feinkost AG', seed: true },
    })
  })

  it('asks for a name', () => {
    expect(validateWorkspaceForm({ name: '   ', seed: false })).toEqual({ error: 'required' })
  })

  it('rejects a name above the maximum length', () => {
    expect(
      validateWorkspaceForm({ name: 'x'.repeat(maxWorkspaceNameLength + 1), seed: false }),
    ).toEqual({ error: 'tooLong' })
  })
})

describe('validateInviteForm', () => {
  it('trims the email address', () => {
    expect(validateInviteForm({ email: ' ana@example.com ', role: 'viewer' })).toEqual({
      input: { email: 'ana@example.com', role: 'viewer' },
    })
  })

  it('asks for an email address', () => {
    expect(validateInviteForm({ email: '', role: 'admin' })).toEqual({ error: 'required' })
  })

  it('rejects an invalid email address', () => {
    expect(validateInviteForm({ email: 'ana@', role: 'admin' })).toEqual({ error: 'invalid' })
  })
})

describe('inviteStatus', () => {
  const pending = { ...invite, acceptedAt: null }
  const expiresAt = new Date(pending.expiresAt)

  it('marks an accepted invite as accepted', () => {
    expect(inviteStatus(invite, new Date(invite.createdAt))).toEqual({
      status: 'accepted',
      on: invite.acceptedAt,
    })
  })

  it('keeps an unaccepted invite pending until it expires', () => {
    expect(inviteStatus(pending, new Date(expiresAt.getTime() - 1))).toEqual({ status: 'pending' })
    expect(inviteStatus(pending, expiresAt)).toEqual({ status: 'expired', on: pending.expiresAt })
  })

  it('shows the seeded invites as accepted, pending and expired today', () => {
    const today = new Date()

    expect(new Set(seedInvites.map((seed) => inviteStatus(seed, today).status))).toEqual(
      new Set(['accepted', 'pending', 'expired']),
    )
  })
})

describe('sameWorkspaceName', () => {
  it('ignores case and surrounding spaces, not accents', () => {
    expect(sameWorkspaceName('nordwind handel ', 'Nordwind Handel')).toBe(true)
    expect(sameWorkspaceName('Muller', 'Müller')).toBe(false)
  })
})
