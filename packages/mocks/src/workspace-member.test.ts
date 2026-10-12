import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { workspaceMembersEndpoint } from '@edi-bridge/contracts'

import { seedWorkspaceSummaries } from './operator'
import { seedSession, showcaseViewerSession } from './session'
import {
  createWorkspaceMembers,
  seedWorkspaceMembers,
  toWorkspaceMemberStore,
  workspaceMemberHandlers,
} from './workspace-member'

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
    expect(
      workspaceMembersEndpoint.response
        .parse(await response.json())
        .map(({ email, role, lastActivityAt }) => ({
          email,
          role,
          signedIn: lastActivityAt !== null,
        })),
    ).toEqual([
      { email: showcaseViewerSession.user.email, role: 'viewer', signedIn: true },
      { email: 'clara.weidner@lindenhof-feinkost.example', role: 'admin', signedIn: true },
      { email: 'felix.brandt@lindenhof-feinkost.example', role: 'viewer', signedIn: true },
      { email: 'nele.albers@lindenhof-feinkost.example', role: 'viewer', signedIn: false },
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

describe('seedWorkspaceMembers', () => {
  it('matches the member count of every seeded Workspace', () => {
    const store = toWorkspaceMemberStore(seedWorkspaceMembers)

    for (const { id, memberCount } of seedWorkspaceSummaries) {
      expect(store.get(id)).toHaveLength(memberCount)
    }
  })
})

describe('toWorkspaceMemberStore', () => {
  it('serves a plain member list for every Workspace', () => {
    const members = createWorkspaceMembers({ count: 2 })
    const store = toWorkspaceMemberStore(members)

    expect(store.get(seedSession.workspace.id)).toBe(members)
    expect(store.get(showcaseViewerSession.workspace.id)).toBe(members)
  })

  it('serves no members for a Workspace missing from the map', () => {
    expect(toWorkspaceMemberStore(new Map()).get(seedSession.workspace.id)).toEqual([])
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

  it('generates the same members on every run without a given time', () => {
    vi.useFakeTimers({ now: new Date('2027-03-01T00:00:00.000Z') })
    const later = createWorkspaceMembers({ count: 20 })
    vi.useRealTimers()

    expect(later).toEqual(createWorkspaceMembers({ count: 20 }))
  })
})
