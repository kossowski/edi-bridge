import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { sessionEndpoint, sessionSchema } from '@edi-bridge/contracts'

import { ensureOperator } from './operator.js'
import {
  type Credentials,
  ownViewer,
  ownWorkspace,
  signIn,
  signInRequest,
  startTestApi,
  type TestApi,
} from './testing.js'

let api: TestApi

beforeAll(async () => {
  api = await startTestApi()
}, 60_000)

afterAll(async () => {
  await api.stop()
})

const passwordOf = (password: string) => vi.fn(() => Promise.resolve(password))

const sessionOf = async (credentials: Credentials) => {
  const client = await signIn(api.app, credentials)
  const response = await client.inject({ method: 'GET', url: sessionEndpoint.path })

  return sessionSchema.parse(response.json())
}

const signInStatus = async (credentials: Credentials) =>
  (await api.app.inject(signInRequest(credentials))).statusCode

describe('ensureOperator', () => {
  it('creates the Operator and their Workspace on a fresh installation', async () => {
    const credentials = { email: 'operator@hafenkontor.example', password: 'first-password' }

    const outcome = await ensureOperator(
      api.connection.db,
      { email: credentials.email, name: 'Hafen Operator', workspaceName: 'Hafenkontor AG' },
      passwordOf(credentials.password),
    )

    expect(outcome).toEqual({
      email: credentials.email,
      user: 'created',
      workspace: 'created',
      operatorGranted: true,
      adminGranted: true,
      passwordReset: false,
    })
    expect(await sessionOf(credentials)).toMatchObject({
      user: { name: 'Hafen Operator', email: credentials.email },
      operator: true,
      workspace: { name: 'Hafenkontor AG' },
      role: 'admin',
    })
  })

  it('keeps the password and roles of an existing Operator', async () => {
    const credentials = { email: 'operator@elbufer.example', password: 'elbufer-password' }

    const input = {
      email: credentials.email,
      name: 'Elbufer Operator',
      workspaceName: 'Elbufer KG',
    }

    await ensureOperator(api.connection.db, input, passwordOf(credentials.password))

    const otherPassword = passwordOf('another-password')

    const outcome = await ensureOperator(api.connection.db, input, otherPassword)

    expect(outcome).toEqual({
      email: credentials.email,
      user: 'found',
      workspace: 'found',
      operatorGranted: false,
      adminGranted: false,
      passwordReset: false,
    })
    expect(otherPassword).not.toHaveBeenCalled()
    expect(await signInStatus(credentials)).toBe(200)
    expect(await signInStatus({ ...credentials, password: 'another-password' })).toBe(401)
  })

  it('grants only the missing Operator flag and Admin role to an existing Viewer', async () => {
    const outcome = await ensureOperator(
      api.connection.db,
      { email: ownViewer.email, name: 'Ignored Name', workspaceName: ownWorkspace.name },
      passwordOf('ignored-password'),
    )

    expect(outcome).toEqual({
      email: ownViewer.email,
      user: 'found',
      workspace: 'found',
      operatorGranted: true,
      adminGranted: true,
      passwordReset: false,
    })
    expect(await sessionOf(ownViewer)).toMatchObject({
      user: { name: ownViewer.name },
      operator: true,
      workspace: { id: ownWorkspace.id },
      role: 'admin',
    })
  })

  it('overwrites the password only when asked to reset it', async () => {
    const credentials = { email: 'operator@alsterhaus.example', password: 'old-password' }
    const input = { email: credentials.email, name: 'Alster Operator', workspaceName: 'Alsterhaus' }

    await ensureOperator(api.connection.db, input, passwordOf(credentials.password))

    const outcome = await ensureOperator(
      api.connection.db,
      { ...input, resetPassword: true },
      passwordOf('new-password'),
    )

    expect(outcome.passwordReset).toBe(true)
    expect(await signInStatus({ ...credentials, password: 'new-password' })).toBe(200)
    expect(await signInStatus(credentials)).toBe(401)
  })

  it('rejects a password shorter than 8 characters and creates nobody', async () => {
    const credentials = { email: 'operator@kurz.example', password: 'short' }

    await expect(
      ensureOperator(
        api.connection.db,
        { email: credentials.email, name: 'Kurz Operator', workspaceName: 'Kurz GmbH' },
        passwordOf(credentials.password),
      ),
    ).rejects.toThrow('at least 8 characters')

    expect(await signInStatus(credentials)).toBe(401)
  })
})
