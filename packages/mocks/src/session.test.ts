import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import {
  liveDemoSignInEndpoint,
  type SignInBody,
  sessionEndpoint,
  sessionSchema,
  signInEndpoint,
  signOutEndpoint,
} from '@edi-bridge/contracts'

import { mockCredentials, sessionHandlers } from './session'
import { seedWorkspace } from './workspace'

const apiUrl = 'http://api.test'

const server = setupServer()

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))

afterEach(() => server.resetHandlers())

afterAll(() => server.close())

async function getSession() {
  return fetch(`${apiUrl}${sessionEndpoint.path}`)
}

async function post(path: string, body?: Partial<SignInBody>) {
  return fetch(`${apiUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? null : JSON.stringify(body),
  })
}

describe('GET /session', () => {
  it('starts signed in as the Operator, Admin of the seed Workspace', async () => {
    server.use(...sessionHandlers(apiUrl))

    const response = await getSession()

    expect(response.status).toBe(200)
    expect(sessionSchema.parse(await response.json())).toMatchObject({
      operator: true,
      role: 'admin',
      workspace: { id: seedWorkspace.id, name: seedWorkspace.name, kind: 'standard' },
    })
  })
})

describe('POST /auth/sign-out', () => {
  it('ends the session, so GET /session answers 401', async () => {
    server.use(...sessionHandlers(apiUrl))

    const response = await post(signOutEndpoint.path)

    expect(signOutEndpoint.response.parse(await response.json())).toEqual({ success: true })
    expect((await getSession()).status).toBe(401)
  })

  it('answers 401 for a signed-out start', async () => {
    server.use(...sessionHandlers(apiUrl, null))

    expect((await getSession()).status).toBe(401)
  })
})

describe('POST /auth/sign-in/email', () => {
  it('signs the showcase-admin in as Admin of the Sandbox Workspace', async () => {
    server.use(...sessionHandlers(apiUrl, null))

    const response = await post(signInEndpoint.path, mockCredentials.showcaseAdmin)
    const session = sessionSchema.parse(await (await getSession()).json())

    expect(response.status).toBe(200)
    expect(signInEndpoint.response.parse(await response.json()).user).toEqual(session.user)
    expect(session).toMatchObject({
      user: { email: mockCredentials.showcaseAdmin.email },
      operator: false,
      role: 'admin',
      workspace: { kind: 'sandbox' },
    })
  })

  it('signs the Operator back in after a sign-out', async () => {
    server.use(...sessionHandlers(apiUrl))
    await post(signOutEndpoint.path)

    await post(signInEndpoint.path, mockCredentials.operator)

    expect(sessionSchema.parse(await (await getSession()).json())).toMatchObject({
      operator: true,
      role: 'admin',
      workspace: { id: seedWorkspace.id },
    })
  })

  it('answers 401 for a wrong password and keeps the user signed out', async () => {
    server.use(...sessionHandlers(apiUrl, null))

    const response = await post(signInEndpoint.path, {
      email: mockCredentials.operator.email,
      password: 'not-the-password',
    })

    expect(response.status).toBe(401)
    expect((await getSession()).status).toBe(401)
  })

  it('answers 401 for an unknown email', async () => {
    server.use(...sessionHandlers(apiUrl, null))

    const response = await post(signInEndpoint.path, {
      email: 'nobody@edi-bridge.example',
      password: mockCredentials.operator.password,
    })

    expect(response.status).toBe(401)
  })

  it('answers 400 for a body without a valid email', async () => {
    server.use(...sessionHandlers(apiUrl, null))

    const response = await post(signInEndpoint.path, { email: 'operator', password: '' })

    expect(response.status).toBe(400)
  })
})

describe('POST /auth/demo', () => {
  it('signs a visitor in as the Viewer of the Showcase Workspace without credentials', async () => {
    server.use(...sessionHandlers(apiUrl, null))

    const response = await post(liveDemoSignInEndpoint.path)

    expect(response.status).toBe(200)
    expect(sessionSchema.parse(await (await getSession()).json())).toMatchObject({
      operator: false,
      role: 'viewer',
      workspace: { kind: 'showcase' },
    })
  })
})
