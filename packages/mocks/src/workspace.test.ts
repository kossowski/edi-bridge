import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import {
  currentWorkspaceEndpoint,
  updateCompanyIdentityEndpoint,
  withCheckDigit,
} from '@edi-bridge/contracts'

import { sandboxAdminSession, seedSession, showcaseViewerSession } from './session'
import { createWorkspace, workspaceHandlers } from './workspace'

const apiUrl = 'http://api.test'

const server = setupServer()

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))

afterEach(() => server.resetHandlers())

afterAll(() => server.close())

const gln = withCheckDigit('024567800000')

async function getCurrent() {
  return fetch(`${apiUrl}${currentWorkspaceEndpoint.path}`)
}

async function putIdentity() {
  return fetch(`${apiUrl}${updateCompanyIdentityEndpoint.path}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ gln }),
  })
}

describe('workspaceHandlers without a session', () => {
  it('serves the given Workspace and changes its company identity', async () => {
    const workspace = createWorkspace({ gln: null })
    server.use(...workspaceHandlers(apiUrl, workspace))

    const response = await putIdentity()
    const current = currentWorkspaceEndpoint.response.parse(await (await getCurrent()).json())

    expect(response.status).toBe(200)
    expect(current).toEqual({ ...workspace, gln })
  })
})

describe('PUT /workspaces/current/identity', () => {
  it('answers 403 for a Viewer and keeps the company identity', async () => {
    const workspace = createWorkspace({ gln: null })
    server.use(...workspaceHandlers(apiUrl, workspace, showcaseViewerSession))

    const response = await putIdentity()
    const current = currentWorkspaceEndpoint.response.parse(await (await getCurrent()).json())

    expect(response.status).toBe(403)
    expect(current.gln).toBeNull()
  })

  it.each([
    ['an Admin', sandboxAdminSession],
    ['the Operator', { ...seedSession, role: 'viewer' as const }],
  ])('lets %s change the company identity', async (_, session) => {
    server.use(...workspaceHandlers(apiUrl, createWorkspace({ gln: null }), session))

    expect((await putIdentity()).status).toBe(200)
  })

  it('answers 401 when signed out', async () => {
    server.use(...workspaceHandlers(apiUrl, createWorkspace(), null))

    expect((await putIdentity()).status).toBe(401)
  })
})

describe('GET /workspaces/current', () => {
  it('answers 401 when signed out', async () => {
    server.use(...workspaceHandlers(apiUrl, createWorkspace(), null))

    expect((await getCurrent()).status).toBe(401)
  })
})
