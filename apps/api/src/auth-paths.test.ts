import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { InjectOptions } from 'fastify'

import { secretBox } from '@edi-bridge/channels'
import { sessionEndpoint, showcaseSignInEndpoint } from '@edi-bridge/contracts'
import { accounts, sessions, users } from '@edi-bridge/db'

import { ensureShowcaseAndSandbox, showcaseAdmin, showcaseViewer } from './showcase-and-sandbox.js'
import {
  type Client,
  signIn,
  signedInClient,
  startTestApi,
  type TestApi,
  testChannels,
  webOrigin,
} from './testing.js'

let api: TestApi

const adminPassword = 'sandbox-admin-password'

interface SharedUser {
  role: string
  email: string
  signIn: () => Promise<Client>
}

const showcaseSignIn = async () =>
  signedInClient(
    api.app,
    await api.app.inject({
      method: 'POST',
      url: showcaseSignInEndpoint.path,
      headers: { origin: webOrigin },
    }),
  )

const sharedUsers: SharedUser[] = [
  { role: 'Viewer of the Showcase', email: showcaseViewer.email, signIn: showcaseSignIn },
  {
    role: 'showcase-admin',
    email: showcaseAdmin.email,
    signIn: () => signIn(api.app, { email: showcaseAdmin.email, password: adminPassword }),
  },
]

const newPassword = 'a-password-of-the-visitor'

const accountChanges: InjectOptions[] = [
  { method: 'POST', url: '/auth/update-user', body: { name: 'Renamed by a visitor' } },
  { method: 'POST', url: '/auth/change-email', body: { newEmail: 'visitor@elsewhere.example' } },
  {
    method: 'POST',
    url: '/auth/change-password',
    body: { currentPassword: adminPassword, newPassword, revokeOtherSessions: true },
  },
  { method: 'POST', url: '/auth/set-password', body: { newPassword } },
  { method: 'POST', url: '/auth/delete-user', body: { password: adminPassword } },
  { method: 'GET', url: '/auth/delete-user/callback?token=any' },
  { method: 'GET', url: '/auth/list-sessions' },
  { method: 'POST', url: '/auth/revoke-session', body: { token: 'any' } },
  { method: 'POST', url: '/auth/revoke-sessions', body: {} },
  { method: 'POST', url: '/auth/revoke-other-sessions', body: {} },
  { method: 'POST', url: '/auth/update-session', body: {} },
  { method: 'GET', url: '/auth/list-accounts' },
  { method: 'GET', url: '/auth/account-info' },
  { method: 'POST', url: '/auth/unlink-account', body: { providerId: 'credential' } },
  { method: 'POST', url: '/auth/link-social', body: { provider: 'github' } },
  { method: 'POST', url: '/auth/get-access-token', body: { providerId: 'credential' } },
  { method: 'POST', url: '/auth/refresh-token', body: { providerId: 'credential' } },
  { method: 'POST', url: '/auth/verify-password', body: { password: adminPassword } },
  { method: 'POST', url: '/auth/send-verification-email', body: { email: showcaseAdmin.email } },
  { method: 'GET', url: '/auth/verify-email?token=any' },
  {
    method: 'POST',
    url: '/auth/request-password-reset',
    body: { email: showcaseAdmin.email, redirectTo: webOrigin },
  },
  { method: 'POST', url: '/auth/reset-password', body: { newPassword, token: 'any' } },
  { method: 'GET', url: '/auth/reset-password/any?callbackURL=/' },
  { method: 'POST', url: '/auth/sign-in/social', body: { provider: 'github' } },
  { method: 'GET', url: '/auth/callback/github?code=any&state=any' },
  { method: 'POST', url: '/auth/sign-up/email', body: { email: 'x@x.example', password: 'x' } },
]

const stateOf = async (email: string) => {
  const [user] = await api.connection.db.select().from(users).where(eq(users.email, email))

  if (user === undefined) {
    throw new Error(`${email} is missing`)
  }

  return {
    user,
    accounts: await api.connection.db.select().from(accounts).where(eq(accounts.userId, user.id)),
    sessions: await api.connection.db
      .select({ id: sessions.id, expiresAt: sessions.expiresAt })
      .from(sessions)
      .where(eq(sessions.userId, user.id))
      .orderBy(sessions.id),
  }
}

const sessionStatus = async (client: Client) =>
  (await client.inject({ method: 'GET', url: sessionEndpoint.path })).statusCode

beforeAll(async () => {
  api = await startTestApi()
  await ensureShowcaseAndSandbox(api.connection.db, {
    secrets: secretBox(testChannels.secretKey),
    adminPassword: () => adminPassword,
  })
}, 60_000)

afterAll(async () => {
  await api.stop()
})

describe.each(sharedUsers)('the auth routes of the $role', ({ email, signIn: signInAs }) => {
  let visitor: Client
  let otherVisitor: Client

  beforeAll(async () => {
    visitor = await signInAs()
    otherVisitor = await signInAs()
  })

  it.each(accountChanges)('do not serve $method $url and change nothing', async (request) => {
    const before = await stateOf(email)

    const response = await visitor.inject(request)

    expect(response.statusCode).toBe(404)
    expect(await stateOf(email)).toEqual(before)
    expect(await sessionStatus(visitor)).toBe(200)
    expect(await sessionStatus(otherVisitor)).toBe(200)
  })

  it('serve GET /auth/get-session', async () => {
    const response = await visitor.inject({ method: 'GET', url: '/auth/get-session' })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ user: { email } })
  })

  it('serve POST /auth/sign-out for this visitor only', async () => {
    const leaving = await signInAs()

    expect(
      (await leaving.inject({ method: 'POST', url: '/auth/sign-out', body: {} })).statusCode,
    ).toBe(200)
    expect(await sessionStatus(leaving)).toBe(401)
    expect(await sessionStatus(visitor)).toBe(200)
  })
})
