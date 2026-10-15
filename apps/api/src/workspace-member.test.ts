import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { z } from 'zod'

import {
  operatorWorkspaceMembersEndpoint,
  removeWorkspaceMemberEndpoint,
  sessionEndpoint,
  toPath,
  workspaceMemberSchema,
  workspaceMembersEndpoint,
} from '@edi-bridge/contracts'

import {
  addMember,
  type Client,
  type NewMember,
  otherAdmin,
  otherWorkspace,
  ownAdmin,
  ownViewer,
  ownWorkspace,
  signIn,
  startTestApi,
  type TestApi,
} from './testing.js'

const membersSchema = z.array(workspaceMemberSchema)

const operatorOfOwnWorkspace: NewMember = {
  name: 'Members Operator',
  email: 'operator@members.example',
  password: 'members-operator-password',
  workspaceId: ownWorkspace.id,
  role: 'admin',
  operator: true,
}

let api: TestApi

let operator: Client

let operatorId: string

beforeAll(async () => {
  api = await startTestApi()
  operatorId = await addMember(api.connection.db, operatorOfOwnWorkspace)
  operator = await signIn(api.app, operatorOfOwnWorkspace)
}, 60_000)

afterAll(async () => {
  await api.stop()
})

const membersOf = async (client: Client, url: string) => {
  const response = await client.inject({ method: 'GET', url })

  expect(response.statusCode).toBe(200)

  return membersSchema.parse(response.json())
}

const currentMembers = (client: Client) => membersOf(client, workspaceMembersEndpoint.path)

const operatorMembersPath = (workspaceId: string) =>
  toPath(operatorWorkspaceMembersEndpoint.path, { workspaceId })

const removePath = (workspaceId: string, userId: string) =>
  toPath(removeWorkspaceMemberEndpoint.path, { workspaceId, userId })

describe('GET /workspaces/current/members', () => {
  it('lists the Members of the own Workspace with their role', async () => {
    const members = await currentMembers(api.viewer)

    expect(members.map(({ name, email, role }) => ({ name, email, role }))).toEqual([
      { name: operatorOfOwnWorkspace.name, email: operatorOfOwnWorkspace.email, role: 'admin' },
      { name: ownAdmin.name, email: ownAdmin.email, role: 'admin' },
      { name: ownViewer.name, email: ownViewer.email, role: 'viewer' },
    ])
  })

  it('records the last activity of a Member on an authenticated request', async () => {
    const quiet: NewMember = {
      name: 'Sudhafen Quiet',
      email: 'quiet@sudhafen.example',
      password: 'sudhafen-quiet-password',
      workspaceId: otherWorkspace.id,
      role: 'viewer',
    }

    await addMember(api.connection.db, quiet)

    const client = await signIn(api.app, quiet)

    const lastActivityOfQuiet = async () =>
      (await currentMembers(api.otherAdmin)).find(({ email }) => email === quiet.email)
        ?.lastActivityAt

    expect(await lastActivityOfQuiet()).toBeNull()

    const before = Date.now()
    await client.inject({ method: 'GET', url: sessionEndpoint.path })
    const after = Date.now()

    const recorded = Date.parse((await lastActivityOfQuiet()) ?? '')

    expect(recorded).toBeGreaterThanOrEqual(before)
    expect(recorded).toBeLessThanOrEqual(after)
  })

  it('answers 401 without a session', async () => {
    const response = await api.app.inject({ method: 'GET', url: workspaceMembersEndpoint.path })

    expect(response.statusCode).toBe(401)
  })
})

describe('GET /operator/workspaces/:workspaceId/members', () => {
  it('lists the Members of a Workspace the Operator is not a Member of', async () => {
    const members = await membersOf(operator, operatorMembersPath(otherWorkspace.id))

    expect(members.map(({ email }) => email)).toContain(otherAdmin.email)
    expect(members.map(({ email }) => email)).not.toContain(operatorOfOwnWorkspace.email)
  })

  it('answers 403 to an Admin who is not the Operator', async () => {
    const response = await api.admin.inject({
      method: 'GET',
      url: operatorMembersPath(ownWorkspace.id),
    })

    expect(response.statusCode).toBe(403)
  })

  it.each([
    ['an unknown', '0f6c2a9e-4b1d-4e83-9a57-3d2b8c1e7f40'],
    ['an invalid', 'not-a-uuid'],
  ])('answers 404 for %s Workspace', async (_, workspaceId) => {
    const response = await operator.inject({
      method: 'GET',
      url: operatorMembersPath(workspaceId),
    })

    expect(response.statusCode).toBe(404)
  })
})

describe('DELETE /operator/workspaces/:workspaceId/members/:userId', () => {
  const unknownUserId = '6a1d9f3b-2c7e-4b58-8e0a-5f4c3b2d1e97'

  const removable = (name: string, workspaceId = ownWorkspace.id): NewMember => ({
    name,
    email: `${name.toLowerCase().replaceAll(' ', '.')}@nordwind.example`,
    password: `${name.toLowerCase().replaceAll(' ', '-')}-password`,
    workspaceId,
    role: 'viewer',
  })

  const memberEmails = async (workspaceId: string) =>
    (await membersOf(operator, operatorMembersPath(workspaceId))).map(({ email }) => email)

  it('removes the Member and signs them out', async () => {
    const leaving = removable('Leaving Viewer')
    const userId = await addMember(api.connection.db, leaving)
    const client = await signIn(api.app, leaving)

    const response = await operator.inject({
      method: removeWorkspaceMemberEndpoint.method,
      url: removePath(ownWorkspace.id, userId),
    })

    expect(response.statusCode).toBe(204)
    expect(await memberEmails(ownWorkspace.id)).not.toContain(leaving.email)
    expect((await client.inject({ method: 'GET', url: sessionEndpoint.path })).statusCode).toBe(401)
  })

  it('answers 403 to an Admin who is not the Operator and keeps the Member', async () => {
    const staying = removable('Staying Viewer')
    const userId = await addMember(api.connection.db, staying)

    const response = await api.admin.inject({
      method: removeWorkspaceMemberEndpoint.method,
      url: removePath(ownWorkspace.id, userId),
    })

    expect(response.statusCode).toBe(403)
    expect(await memberEmails(ownWorkspace.id)).toContain(staying.email)
  })

  it('answers 404 for a user who is not a Member of the Workspace', async () => {
    const elsewhere = removable('Elsewhere Viewer', otherWorkspace.id)
    const userId = await addMember(api.connection.db, elsewhere)

    const response = await operator.inject({
      method: removeWorkspaceMemberEndpoint.method,
      url: removePath(ownWorkspace.id, userId),
    })

    expect(response.statusCode).toBe(404)
    expect(await memberEmails(otherWorkspace.id)).toContain(elsewhere.email)
  })

  it.each([
    ['an unknown Workspace', '0f6c2a9e-4b1d-4e83-9a57-3d2b8c1e7f40', unknownUserId],
    ['an unknown user', ownWorkspace.id, unknownUserId],
    ['an invalid Workspace id', 'not-a-uuid', unknownUserId],
    ['an invalid user id', ownWorkspace.id, 'not-a-uuid'],
  ])('answers 404 for %s', async (_, workspaceId, userId) => {
    const response = await operator.inject({
      method: removeWorkspaceMemberEndpoint.method,
      url: removePath(workspaceId, userId),
    })

    expect(response.statusCode).toBe(404)
  })

  it('refuses to remove the Operator themselves', async () => {
    const response = await operator.inject({
      method: removeWorkspaceMemberEndpoint.method,
      url: removePath(ownWorkspace.id, operatorId),
    })

    expect(response.statusCode).toBe(409)
    expect(await memberEmails(ownWorkspace.id)).toContain(operatorOfOwnWorkspace.email)
  })
})
