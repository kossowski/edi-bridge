import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  sessionEndpoint,
  sessionSchema,
  signedInSchema,
  signOutEndpoint,
} from '@edi-bridge/contracts'

import {
  addMember,
  type Client,
  type Member,
  otherWorkspace,
  ownAdmin,
  ownWorkspace,
  signIn,
  signInRequest,
  startTestApi,
  type TestApi,
  webOrigin,
} from './testing.js'

const operator: Member = {
  name: 'Platform Operator',
  email: 'operator@platform.example',
  password: 'operator-password',
  workspaceId: otherWorkspace.id,
  role: 'admin',
  operator: true,
}

let api: TestApi

beforeAll(async () => {
  api = await startTestApi()
  await addMember(api.connection.db, operator)
}, 60_000)

afterAll(async () => {
  await api.stop()
})

const getSession = (target: Client = api.app) =>
  target.inject({ method: 'GET', url: sessionEndpoint.path })

describe('POST /auth/sign-in/email', () => {
  it('signs a member in with email and password', async () => {
    const response = await api.app.inject(signInRequest(ownAdmin))

    expect(response.statusCode).toBe(200)
    expect(signedInSchema.parse(response.json()).user).toMatchObject({
      name: ownAdmin.name,
      email: ownAdmin.email,
    })
    expect(response.cookies.some(({ httpOnly }) => httpOnly)).toBe(true)
  })

  it.each([
    ['a wrong password', { email: ownAdmin.email, password: 'wrong-password' }],
    ['an unknown email', { email: 'nobody@nordwind.example', password: ownAdmin.password }],
  ])('rejects %s without a session', async (_case, credentials) => {
    const response = await api.app.inject(signInRequest(credentials))

    expect(response.statusCode).toBe(401)
    expect(response.cookies).toEqual([])
  })
})

describe('POST /auth/sign-up/email', () => {
  it('does not exist, so nobody can sign up', async () => {
    const credentials = { email: 'newcomer@nordwind.example', password: 'newcomer-password' }

    const response = await api.app.inject({
      method: 'POST',
      url: '/auth/sign-up/email',
      headers: { origin: webOrigin },
      body: { ...credentials, name: 'Newcomer' },
    })

    expect(response.statusCode).toBe(404)
    expect((await api.app.inject(signInRequest(credentials))).statusCode).toBe(401)
  })
})

describe('GET /session', () => {
  it('answers 401 without a session cookie', async () => {
    const response = await getSession()

    expect(response.statusCode).toBe(401)
    expect(response.json()).toHaveProperty('message')
  })

  it('answers 401 for an unknown session cookie', async () => {
    const response = await api.app.inject({
      method: 'GET',
      url: sessionEndpoint.path,
      cookies: { 'better-auth.session_token': 'forged.token' },
    })

    expect(response.statusCode).toBe(401)
  })

  it('returns the signed-in user with their Workspace and role', async () => {
    const response = await getSession(api.admin)

    expect(response.statusCode).toBe(200)

    const session = sessionSchema.parse(response.json())

    expect(session).toEqual({
      user: { id: session.user.id, name: ownAdmin.name, email: ownAdmin.email },
      operator: false,
      workspace: { id: ownWorkspace.id, name: ownWorkspace.name, kind: 'standard' },
      role: 'admin',
    })
  })

  it('opens the Workspace of the member who signed in', async () => {
    const response = await getSession(api.otherAdmin)

    expect(sessionSchema.parse(response.json()).workspace).toEqual({
      id: otherWorkspace.id,
      name: otherWorkspace.name,
      kind: 'standard',
    })
  })

  it('marks the Operator', async () => {
    const response = await getSession(await signIn(api.app, operator))

    expect(sessionSchema.parse(response.json())).toMatchObject({
      operator: true,
      workspace: { id: otherWorkspace.id },
      role: 'admin',
    })
  })
})

describe('POST /auth/sign-out', () => {
  it('ends the session', async () => {
    const client = await signIn(api.app, ownAdmin)

    const response = await client.inject({ method: 'POST', url: signOutEndpoint.path })

    expect(response.statusCode).toBe(200)
    expect((await getSession(client)).statusCode).toBe(401)
  })
})
