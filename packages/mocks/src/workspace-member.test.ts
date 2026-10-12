import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import { workspaceMembersEndpoint } from '@edi-bridge/contracts'

import { seedSession, showcaseViewerSession } from './session'
import { createWorkspaceMembers, workspaceMemberHandlers } from './workspace-member'

const apiUrl = 'http://api.test'

const server = setupServer()

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))

afterEach(() => server.resetHandlers())

afterAll(() => server.close())

async function getMembers() {
  return fetch(`${apiUrl}${workspaceMembersEndpoint.path}`)
}

describe('GET /workspaces/current/members', () => {
  it('lists the members of the session Workspace with role and last activity', async () => {
    server.use(...workspaceMemberHandlers(apiUrl))

    const members = workspaceMembersEndpoint.response.parse(await (await getMembers()).json())

    expect(members.map(({ email, role }) => ({ email, role }))).toEqual([
      { email: seedSession.user.email, role: 'admin' },
      { email: 'mara.olsen@nordwind-handel.example', role: 'admin' },
      { email: 'tobias.reuter@nordwind-handel.example', role: 'admin' },
      { email: 'lena.hoffmann@nordwind-handel.example', role: 'viewer' },
    ])
  })

  it('lists only the members of the Workspace the Viewer is signed in to', async () => {
    server.use(...workspaceMemberHandlers(apiUrl, { session: showcaseViewerSession }))

    const response = await getMembers()

    expect(response.status).toBe(200)
    expect(workspaceMembersEndpoint.response.parse(await response.json())).toEqual([
      expect.objectContaining({ email: showcaseViewerSession.user.email, role: 'viewer' }),
    ])
  })

  it('serves an empty member list', async () => {
    server.use(...workspaceMemberHandlers(apiUrl, { members: [] }))

    expect(await (await getMembers()).json()).toEqual([])
  })

  it('answers 401 when signed out', async () => {
    server.use(...workspaceMemberHandlers(apiUrl, { session: null }))

    expect((await getMembers()).status).toBe(401)
  })
})

describe('createWorkspaceMembers', () => {
  it('generates many distinct members, some of whom never signed in', () => {
    const members = createWorkspaceMembers({ count: 250 })

    expect(members).toHaveLength(250)
    expect(new Set(members.map(({ email }) => email)).size).toBe(250)
    expect(new Set(members.map(({ id }) => id)).size).toBe(250)
    expect(members.some(({ lastActivityAt }) => lastActivityAt === null)).toBe(true)
    expect(new Set(members.map(({ role }) => role))).toEqual(new Set(['admin', 'viewer']))
  })

  it('generates the same members for the same seed and time', () => {
    const now = new Date('2026-10-12T09:00:00.000Z')

    expect(createWorkspaceMembers({ count: 5, seed: 3, now })).toEqual(
      createWorkspaceMembers({ count: 5, seed: 3, now }),
    )
  })
})
