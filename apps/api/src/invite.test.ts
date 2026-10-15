import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import {
  acceptInviteEndpoint,
  createInviteEndpoint,
  type InviteInput,
  inviteSchema,
  inviteUnusableStatus,
  inviteValidityDays,
  revokeInviteEndpoint,
  sessionEndpoint,
  sessionSchema,
  toPath,
  workspaceInvitesEndpoint,
} from '@edi-bridge/contracts'

import { buildApp } from './app.js'
import {
  addMember,
  type Client,
  type Credentials,
  type NewMember,
  otherWorkspace,
  ownAdmin,
  ownWorkspace,
  signIn,
  signInRequest,
  startTestApi,
  type TestApi,
  testAuth,
  webOrigin,
} from './testing.js'

const operatorOfOwnWorkspace: NewMember = {
  name: 'Invite Operator',
  email: 'operator@invites.example',
  password: 'invite-operator-password',
  workspaceId: ownWorkspace.id,
  role: 'viewer',
  operator: true,
}

const dayMs = 24 * 60 * 60 * 1000

let api: TestApi

let operator: Client

beforeAll(async () => {
  api = await startTestApi()
  await addMember(api.connection.db, operatorOfOwnWorkspace)
  operator = await signIn(api.app, operatorOfOwnWorkspace)
}, 60_000)

afterAll(async () => {
  await api.stop()
})

afterEach(() => {
  vi.useRealTimers()
})

const invitesPath = (workspaceId: string) => toPath(workspaceInvitesEndpoint.path, { workspaceId })

const revokePath = (workspaceId: string, inviteId: string) =>
  toPath(revokeInviteEndpoint.path, { workspaceId, inviteId })

const acceptPath = (token: string) => toPath(acceptInviteEndpoint.path, { token })

async function createInvite(input: InviteInput, workspaceId = otherWorkspace.id) {
  const response = await operator.inject({
    method: createInviteEndpoint.method,
    url: toPath(createInviteEndpoint.path, { workspaceId }),
    body: input,
  })

  expect(response.statusCode).toBe(201)

  return inviteSchema.parse(response.json())
}

async function listInvites(workspaceId = otherWorkspace.id) {
  const response = await operator.inject({ method: 'GET', url: invitesPath(workspaceId) })

  expect(response.statusCode).toBe(200)

  return z.array(inviteSchema).parse(response.json())
}

const tokenOf = (link: string) => new URL(link).pathname.split('/').at(-1) ?? ''

const accept = (link: string, body: { name: string; password: string }) =>
  api.app.inject({ method: acceptInviteEndpoint.method, url: acceptPath(tokenOf(link)), body })

const signInStatus = async (credentials: Credentials) =>
  (await api.app.inject(signInRequest(credentials))).statusCode

describe('POST /operator/workspaces/:workspaceId/invites', () => {
  it('creates an invite with a link to the web origin that is valid for 7 days', async () => {
    const invite = await createInvite({ email: 'jana.kruse@sudhafen.example', role: 'viewer' })

    expect(invite).toMatchObject({
      workspaceId: otherWorkspace.id,
      email: 'jana.kruse@sudhafen.example',
      role: 'viewer',
      acceptedAt: null,
      revokedAt: null,
    })
    expect(invite.link).toMatch(new RegExp(`^${webOrigin}/invite/[\\w-]{32,}$`))
    expect(Date.parse(invite.expiresAt) - Date.parse(invite.createdAt)).toBe(
      inviteValidityDays * dayMs,
    )
  })

  it('gives every invite its own link', async () => {
    const first = await createInvite({ email: 'twice@sudhafen.example', role: 'viewer' })
    const second = await createInvite({ email: 'twice@sudhafen.example', role: 'viewer' })

    expect(first.link).not.toBe(second.link)
  })

  it('links to the origin of BETTER_AUTH_URL when no web origin is set', async () => {
    const sameOrigin = buildApp({
      auth: testAuth,
      database: api.connection.db,
      probes: { postgres: () => Promise.resolve(), redis: () => Promise.resolve() },
    })

    const client = await signIn(sameOrigin, operatorOfOwnWorkspace)

    const response = await client.inject({
      method: createInviteEndpoint.method,
      url: invitesPath(otherWorkspace.id),
      body: { email: 'same.origin@sudhafen.example', role: 'admin' },
    })

    await sameOrigin.close()

    expect(inviteSchema.parse(response.json()).link).toMatch(
      new RegExp(`^${new URL(testAuth.baseUrl).origin}/invite/`),
    )
  })

  it('answers 404 for an unknown Workspace', async () => {
    const response = await operator.inject({
      method: createInviteEndpoint.method,
      url: invitesPath('5d0f3c1e-8a4b-4e6f-9b2d-1c7a3e5f9d08'),
      body: { email: 'nobody@example.com', role: 'viewer' },
    })

    expect(response.statusCode).toBe(404)
  })

  it('answers 400 for an invalid email', async () => {
    const response = await operator.inject({
      method: createInviteEndpoint.method,
      url: invitesPath(otherWorkspace.id),
      body: { email: 'not-an-email', role: 'viewer' },
    })

    expect(response.statusCode).toBe(400)
  })
})

describe('GET /operator/workspaces/:workspaceId/invites', () => {
  it('lists the invites of the Workspace, newest first', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.now() - 60_000)

    const older = await createInvite(
      { email: 'older@nordwind.example', role: 'viewer' },
      ownWorkspace.id,
    )

    vi.useRealTimers()

    const newer = await createInvite(
      { email: 'newer@nordwind.example', role: 'admin' },
      ownWorkspace.id,
    )

    const listed = await listInvites(ownWorkspace.id)

    expect(listed.map(({ id }) => id)).toEqual(expect.arrayContaining([older.id, newer.id]))
    expect(listed.findIndex(({ id }) => id === newer.id)).toBeLessThan(
      listed.findIndex(({ id }) => id === older.id),
    )
    expect(listed.every(({ workspaceId }) => workspaceId === ownWorkspace.id)).toBe(true)
    expect(listed.find(({ id }) => id === newer.id)).toEqual(newer)
  })

  it('answers 404 for an unknown Workspace', async () => {
    const response = await operator.inject({
      method: 'GET',
      url: invitesPath('5d0f3c1e-8a4b-4e6f-9b2d-1c7a3e5f9d08'),
    })

    expect(response.statusCode).toBe(404)
  })
})

describe('DELETE /operator/workspaces/:workspaceId/invites/:inviteId', () => {
  it('revokes an open invite and drops it from the list', async () => {
    const invite = await createInvite({ email: 'revoked@sudhafen.example', role: 'viewer' })

    const response = await operator.inject({
      method: revokeInviteEndpoint.method,
      url: revokePath(otherWorkspace.id, invite.id),
    })

    expect(response.statusCode).toBe(200)
    const revoked = inviteSchema.parse(response.json())

    expect(revoked.id).toBe(invite.id)
    expect(revoked.revokedAt).not.toBeNull()
    expect((await listInvites()).map(({ id }) => id)).not.toContain(invite.id)
  })

  it('answers 404 for a revoked invite or one of another Workspace', async () => {
    const invite = await createInvite({ email: 'twice.revoked@sudhafen.example', role: 'viewer' })

    await operator.inject({ method: 'DELETE', url: revokePath(otherWorkspace.id, invite.id) })

    const again = await operator.inject({
      method: 'DELETE',
      url: revokePath(otherWorkspace.id, invite.id),
    })

    const elsewhere = await createInvite({ email: 'elsewhere@sudhafen.example', role: 'viewer' })

    const wrongWorkspace = await operator.inject({
      method: 'DELETE',
      url: revokePath(ownWorkspace.id, elsewhere.id),
    })

    const notAnId = await operator.inject({
      method: 'DELETE',
      url: revokePath(otherWorkspace.id, 'not-an-id'),
    })

    expect([again.statusCode, wrongWorkspace.statusCode, notAnId.statusCode]).toEqual([
      404, 404, 404,
    ])
  })

  it('answers 409 for an accepted invite', async () => {
    const invite = await createInvite({ email: 'accepted@sudhafen.example', role: 'viewer' })
    await accept(invite.link, { name: 'Accepted User', password: 'accepted-password' })

    const response = await operator.inject({
      method: 'DELETE',
      url: revokePath(otherWorkspace.id, invite.id),
    })

    expect(response.statusCode).toBe(409)
  })
})

describe('the Operator routes', () => {
  const requests = () => [
    { method: 'GET' as const, url: invitesPath(otherWorkspace.id) },
    {
      method: 'POST' as const,
      url: invitesPath(otherWorkspace.id),
      body: { email: 'forbidden@sudhafen.example', role: 'admin' },
    },
    {
      method: 'DELETE' as const,
      url: revokePath(otherWorkspace.id, '5d0f3c1e-8a4b-4e6f-9b2d-1c7a3e5f9d08'),
    },
  ]

  it('answer 403 to an Admin, even of the target Workspace', async () => {
    const statuses = await Promise.all(
      requests().map(async (request) => (await api.otherAdmin.inject(request)).statusCode),
    )

    expect(statuses).toEqual([403, 403, 403])
  })

  it('answer 401 without a session', async () => {
    const statuses = await Promise.all(
      requests().map(async (request) => (await api.app.inject(request)).statusCode),
    )

    expect(statuses).toEqual([401, 401, 401])
  })
})

describe('POST /invites/:token/accept', () => {
  it('sets the password of a new user who then signs in as a Member', async () => {
    const invite = await createInvite({ email: 'Nina.Vogt@Sudhafen.example', role: 'admin' })

    const response = await accept(invite.link, { name: 'Nina Vogt', password: 'nina-password' })

    expect(response.statusCode).toBe(204)

    const client = await signIn(api.app, {
      email: 'nina.vogt@sudhafen.example',
      password: 'nina-password',
    })

    const session = await client.inject({ method: 'GET', url: sessionEndpoint.path })

    expect(sessionSchema.parse(session.json())).toMatchObject({
      user: { name: 'Nina Vogt', email: 'nina.vogt@sudhafen.example' },
      operator: false,
      workspace: { id: otherWorkspace.id },
      role: 'admin',
    })
    expect((await listInvites()).find(({ id }) => id === invite.id)?.acceptedAt).toEqual(
      expect.any(String),
    )
  })

  it('rejects a used link', async () => {
    const invite = await createInvite({ email: 'used@sudhafen.example', role: 'viewer' })
    await accept(invite.link, { name: 'Used Link', password: 'first-password' })

    const response = await accept(invite.link, { name: 'Used Link', password: 'second-password' })

    expect(response.statusCode).toBe(inviteUnusableStatus)
    expect(await signInStatus({ email: invite.email, password: 'second-password' })).toBe(401)
  })

  it('rejects a revoked link', async () => {
    const invite = await createInvite({ email: 'revoked.link@sudhafen.example', role: 'viewer' })
    await operator.inject({ method: 'DELETE', url: revokePath(otherWorkspace.id, invite.id) })

    const response = await accept(invite.link, { name: 'Revoked', password: 'revoked-password' })

    expect(response.statusCode).toBe(inviteUnusableStatus)
    expect(await signInStatus({ email: invite.email, password: 'revoked-password' })).toBe(401)
  })

  it('rejects a link after 7 days', async () => {
    const invite = await createInvite({ email: 'expired@sudhafen.example', role: 'viewer' })

    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.parse(invite.expiresAt) + 1000)

    const response = await accept(invite.link, { name: 'Expired', password: 'expired-password' })

    vi.useRealTimers()

    expect(response.statusCode).toBe(inviteUnusableStatus)
    expect(await signInStatus({ email: invite.email, password: 'expired-password' })).toBe(401)
  })

  it('accepts a link shortly before it expires', async () => {
    const invite = await createInvite({ email: 'late@sudhafen.example', role: 'viewer' })

    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.parse(invite.expiresAt) - 1000)

    const response = await accept(invite.link, { name: 'Late', password: 'late-password' })

    vi.useRealTimers()

    expect(response.statusCode).toBe(204)
  })

  it('answers 404 for an unknown token', async () => {
    const response = await api.app.inject({
      method: 'POST',
      url: acceptPath('unknown-token'),
      body: { name: 'Nobody', password: 'nobody-password' },
    })

    expect(response.statusCode).toBe(404)
  })

  it('answers 400 for a password shorter than 8 characters and keeps the link open', async () => {
    const invite = await createInvite({ email: 'short@sudhafen.example', role: 'viewer' })

    const short = await accept(invite.link, { name: 'Short', password: 'short' })
    const valid = await accept(invite.link, { name: 'Short', password: 'long-enough' })

    expect([short.statusCode, valid.statusCode]).toEqual([400, 204])
  })

  it('adds an existing user to the Workspace when their password matches', async () => {
    const invite = await createInvite({ email: ownAdmin.email, role: 'viewer' })

    const response = await accept(invite.link, { name: 'Ignored', password: ownAdmin.password })

    expect(response.statusCode).toBe(204)
    expect((await listInvites()).find(({ id }) => id === invite.id)?.acceptedAt).toEqual(
      expect.any(String),
    )
    expect(await signInStatus(ownAdmin)).toBe(200)
  })

  it('keeps the password of an existing user and the link open on a wrong password', async () => {
    const existing: NewMember = {
      name: 'Existing User',
      email: 'existing@nordwind.example',
      password: 'existing-password',
      workspaceId: ownWorkspace.id,
      role: 'viewer',
    }

    await addMember(api.connection.db, existing)
    const invite = await createInvite({ email: existing.email, role: 'admin' })

    const response = await accept(invite.link, { name: 'Takeover', password: 'takeover-password' })

    expect(response.statusCode).toBe(403)
    expect(await signInStatus({ email: existing.email, password: 'takeover-password' })).toBe(401)
    expect(await signInStatus(existing)).toBe(200)
    expect((await listInvites()).find(({ id }) => id === invite.id)?.acceptedAt).toBeNull()
  })
})
