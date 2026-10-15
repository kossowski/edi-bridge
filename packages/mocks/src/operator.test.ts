import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import {
  acceptInviteEndpoint,
  createInviteEndpoint,
  createWorkspaceEndpoint,
  type Invite,
  type InviteInput,
  inviteSchema,
  inviteUnusableProblem,
  inviteUnusableStatus,
  inviteValidityDays,
  operatorWorkspaceMembersEndpoint,
  removeWorkspaceMemberEndpoint,
  resetSandboxWorkspaceEndpoint,
  revokeInviteEndpoint,
  sessionEndpoint,
  sessionSchema,
  signInEndpoint,
  toPath,
  workspaceInvitesEndpoint,
  glnIssue,
  type WorkspaceInput,
  operatorWorkspacesEndpoint,
  type WorkspaceSummary,
  workspaceSummarySchema,
} from '@edi-bridge/contracts'

import { dayMs } from './duration'
import {
  createInvites,
  createOperatorStore,
  createWorkspaceSummaries,
  operatorHandlers,
  seedInvites,
  seedWorkspaceSummaries,
} from './operator'
import { seedId } from './seed-id'
import {
  createAccountStore,
  createSessionStore,
  mockCredentials,
  sandboxAdminSession,
  seedSession,
  sessionHandlers,
  showcaseViewerSession,
} from './session'
import { seedSandboxWorkspace, seedShowcaseWorkspace, seedWorkspace } from './workspace'
import { createWorkspaceMembers } from './workspace-member'

const apiUrl = 'http://api.test'

const server = setupServer()

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))

afterEach(() => {
  server.resetHandlers()
  vi.useRealTimers()
})

afterAll(() => server.close())

function isUnansweredSeedInvite({ workspaceId, acceptedAt }: Invite) {
  return workspaceId === seedWorkspace.id && acceptedAt === null
}

async function post(path: string, body?: Partial<WorkspaceInput> | Partial<InviteInput>) {
  return fetch(`${apiUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? null : JSON.stringify(body),
  })
}

async function listWorkspaces() {
  const response = await fetch(`${apiUrl}${operatorWorkspacesEndpoint.path}`)

  return operatorWorkspacesEndpoint.response.parse(await response.json())
}

describe('seedWorkspaceSummaries', () => {
  it('holds the seed Workspace, a Showcase and a Sandbox Workspace', () => {
    expect(seedWorkspaceSummaries.map(({ kind }) => kind).sort()).toEqual([
      'sandbox',
      'showcase',
      'standard',
    ])

    expect(seedWorkspaceSummaries.find(({ kind }) => kind === 'standard')).toMatchObject(
      seedWorkspace,
    )
  })

  it('gives every seed Workspace documents today and a last activity', () => {
    for (const { documentsToday, lastActivityAt } of seedWorkspaceSummaries) {
      expect(documentsToday).toBeGreaterThan(0)
      expect(lastActivityAt).not.toBeNull()
    }
  })

  it('marks every seed Workspace as seeded', () => {
    expect(seedWorkspaceSummaries.every(({ seeded }) => seeded)).toBe(true)
  })

  it('uses valid GLNs from the restricted-circulation prefixes 020–029', () => {
    for (const { gln } of seedWorkspaceSummaries) {
      expect(gln).toMatch(/^02\d{11}$/)
      expect(glnIssue(gln!)).toBeNull()
    }
  })
})

describe('createWorkspaceSummaries', () => {
  it('generates hundreds of valid Workspaces with unique names', () => {
    const workspaces = createWorkspaceSummaries({ count: 300 })

    expect(workspaces).toHaveLength(300)
    expect(new Set(workspaces.map(({ id }) => id)).size).toBe(300)
    expect(new Set(workspaces.map(({ name }) => name)).size).toBe(300)

    for (const workspace of workspaces) {
      expect(workspaceSummarySchema.omit({ pendingInviteCount: true }).parse(workspace)).toEqual(
        workspace,
      )
      expect(workspace.gln === null || /^02\d{11}$/.test(workspace.gln)).toBe(true)
    }
  })

  it('generates quiet Workspaces without activity next to busy ones', () => {
    const workspaces = createWorkspaceSummaries({ count: 300 })

    expect(workspaces.some(({ lastActivityAt }) => lastActivityAt === null)).toBe(true)
    expect(workspaces.some(({ documentsToday }) => documentsToday > 1000)).toBe(true)
  })

  it('generates the same Workspaces for the same seed and date', () => {
    const now = new Date('2026-10-11T08:00:00.000Z')

    expect(createWorkspaceSummaries({ count: 5, seed: 3, now })).toEqual(
      createWorkspaceSummaries({ count: 5, seed: 3, now }),
    )
  })
})

describe('GET /operator/workspaces', () => {
  it('lists the seeded Workspaces sorted by name', async () => {
    server.use(...operatorHandlers(apiUrl))

    const workspaces = await listWorkspaces()

    expect(workspaces.map(({ id }) => id).sort()).toEqual(
      seedWorkspaceSummaries.map(({ id }) => id).sort(),
    )
    expect(workspaces.map(({ name }) => name)).toEqual(
      workspaces.map(({ name }) => name).sort((a, b) => a.localeCompare(b, 'de')),
    )
  })

  it('lists no Workspaces for the empty state', async () => {
    server.use(...operatorHandlers(apiUrl, { workspaces: [] }))

    expect(await listWorkspaces()).toEqual([])
  })

  it('answers 401 when signed out', async () => {
    server.use(...operatorHandlers(apiUrl, { session: null }))

    const response = await fetch(`${apiUrl}${operatorWorkspacesEndpoint.path}`)

    expect(response.status).toBe(401)
  })

  it('answers 403 for an Admin who is not the Operator', async () => {
    server.use(...operatorHandlers(apiUrl, { session: sandboxAdminSession }))

    const response = await fetch(`${apiUrl}${operatorWorkspacesEndpoint.path}`)

    expect(response.status).toBe(403)
  })
})

describe('POST /operator/workspaces', () => {
  it('creates an empty standard Workspace and lists it', async () => {
    server.use(...operatorHandlers(apiUrl, { workspaces: [] }))

    const response = await post(createWorkspaceEndpoint.path, {
      name: '  Havelland Feinkost GmbH ',
      seed: false,
    })

    const created = createWorkspaceEndpoint.response.parse(await response.json())

    expect(response.status).toBe(201)
    expect(created).toMatchObject({
      name: 'Havelland Feinkost GmbH',
      gln: null,
      kind: 'standard',
      memberCount: 0,
      pendingInviteCount: 0,
      documentsToday: 0,
      lastActivityAt: null,
      lastResetAt: null,
      seeded: false,
    })
    expect(await listWorkspaces()).toEqual([created])
  })

  it('creates a seeded Workspace with a valid company GLN and lists it as seeded', async () => {
    server.use(...operatorHandlers(apiUrl, { workspaces: [] }))

    const response = await post(createWorkspaceEndpoint.path, {
      name: 'Havelland Feinkost GmbH',
      seed: true,
    })

    const { gln, seeded } = createWorkspaceEndpoint.response.parse(await response.json())
    const [listed] = await listWorkspaces()

    expect(seeded).toBe(true)
    expect(listed?.seeded).toBe(true)
    expect(gln).toMatch(/^02\d{11}$/)
    expect(glnIssue(gln!)).toBeNull()
  })

  it('answers 409 for a name another Workspace already uses', async () => {
    server.use(...operatorHandlers(apiUrl))

    const response = await post(createWorkspaceEndpoint.path, {
      name: seedWorkspace.name,
      seed: false,
    })

    expect(response.status).toBe(409)
  })

  it.each([
    ['an empty name', { name: '  ', seed: false }],
    ['a name over 70 characters', { name: 'x'.repeat(71), seed: false }],
    ['a missing seed option', { name: 'Havelland Feinkost GmbH' }],
  ])('answers 400 for %s', async (_, body) => {
    server.use(...operatorHandlers(apiUrl))

    expect((await post(createWorkspaceEndpoint.path, body)).status).toBe(400)
  })

  it('answers 403 for an Admin who is not the Operator', async () => {
    server.use(...operatorHandlers(apiUrl, { session: sandboxAdminSession }))

    const response = await post(createWorkspaceEndpoint.path, { name: 'Havelland', seed: true })

    expect(response.status).toBe(403)
  })
})

const unknownWorkspaceId = '00000000-0000-4000-8000-000000000000'

async function listInvites(workspaceId: string) {
  return fetch(`${apiUrl}${toPath(workspaceInvitesEndpoint.path, { workspaceId })}`)
}

async function listMembers(workspaceId: string) {
  return fetch(`${apiUrl}${toPath(operatorWorkspaceMembersEndpoint.path, { workspaceId })}`)
}

describe('GET /operator/workspaces/:workspaceId/members', () => {
  it('lists the members of any Workspace with their role', async () => {
    server.use(...operatorHandlers(apiUrl))

    const response = await listMembers(seedShowcaseWorkspace.id)
    const members = operatorWorkspaceMembersEndpoint.response.parse(await response.json())

    expect(response.status).toBe(200)
    expect(members.map(({ email, role }) => ({ email, role }))).toEqual([
      { email: showcaseViewerSession.user.email, role: 'viewer' },
      { email: 'clara.weidner@lindenhof-feinkost.example', role: 'admin' },
      { email: 'felix.brandt@lindenhof-feinkost.example', role: 'viewer' },
      { email: 'nele.albers@lindenhof-feinkost.example', role: 'viewer' },
    ])
  })

  it('counts as many members as the seed Workspace summaries say', async () => {
    server.use(...operatorHandlers(apiUrl))

    for (const { id, memberCount } of seedWorkspaceSummaries) {
      const members = operatorWorkspaceMembersEndpoint.response.parse(
        await (await listMembers(id)).json(),
      )

      expect(members).toHaveLength(memberCount)
    }
  })

  it('lists hundreds of members for the large-volume state', async () => {
    const members = createWorkspaceMembers({ count: 200 })
    server.use(...operatorHandlers(apiUrl, { members }))

    expect(await (await listMembers(seedWorkspace.id)).json()).toEqual(members)
  })

  it('lists no members for a Workspace without any', async () => {
    server.use(...operatorHandlers(apiUrl, { members: [] }))

    expect(await (await listMembers(seedWorkspace.id)).json()).toEqual([])
  })

  it('answers 404 for an unknown Workspace', async () => {
    server.use(...operatorHandlers(apiUrl))

    expect((await listMembers(unknownWorkspaceId)).status).toBe(404)
  })

  it('answers 403 for an Admin who is not the Operator', async () => {
    server.use(...operatorHandlers(apiUrl, { session: sandboxAdminSession }))

    expect((await listMembers(seedSandboxWorkspace.id)).status).toBe(403)
  })
})

describe('DELETE /operator/workspaces/:workspaceId/members/:userId', () => {
  const remove = (workspaceId: string, userId: string) =>
    fetch(`${apiUrl}${toPath(removeWorkspaceMemberEndpoint.path, { workspaceId, userId })}`, {
      method: 'DELETE',
    })

  const membersOf = async (workspaceId: string) =>
    operatorWorkspaceMembersEndpoint.response.parse(await (await listMembers(workspaceId)).json())

  const memberCountOf = async (workspaceId: string) =>
    (await listWorkspaces()).find(({ id }) => id === workspaceId)?.memberCount

  it('removes a Member from the list and the member count', async () => {
    server.use(...operatorHandlers(apiUrl))
    const [, leaving] = await membersOf(seedShowcaseWorkspace.id)

    const response = await remove(seedShowcaseWorkspace.id, leaving!.id)

    expect(response.status).toBe(204)
    expect((await membersOf(seedShowcaseWorkspace.id)).map(({ id }) => id)).not.toContain(
      leaving!.id,
    )
    expect(await memberCountOf(seedShowcaseWorkspace.id)).toBe(3)
  })

  it('answers 404 for a Member removed before', async () => {
    server.use(...operatorHandlers(apiUrl))
    const [, leaving] = await membersOf(seedShowcaseWorkspace.id)

    await remove(seedShowcaseWorkspace.id, leaving!.id)

    expect((await remove(seedShowcaseWorkspace.id, leaving!.id)).status).toBe(404)
  })

  it.each([
    ['an unknown Member', seedWorkspace.id, unknownWorkspaceId],
    ['a Member of another Workspace', seedSandboxWorkspace.id, seedId(11, 4)],
    ['an unknown Workspace', unknownWorkspaceId, seedId(11, 4)],
  ])('answers 404 for %s', async (_, workspaceId, userId) => {
    server.use(...operatorHandlers(apiUrl))

    expect((await remove(workspaceId, userId)).status).toBe(404)
  })

  it('refuses to remove the Operator themselves', async () => {
    server.use(...operatorHandlers(apiUrl))

    expect((await remove(seedWorkspace.id, seedSession.user.id)).status).toBe(409)
  })

  it('refuses to remove the Operator themselves before looking up the Workspace', async () => {
    server.use(...operatorHandlers(apiUrl))

    expect((await remove(unknownWorkspaceId, seedSession.user.id)).status).toBe(409)
  })

  it('counts the Members from the member list', async () => {
    const workspaces = seedWorkspaceSummaries.map((workspace) => ({
      ...workspace,
      memberCount: 40,
    }))

    server.use(...operatorHandlers(apiUrl, { workspaces }))
    const [, leaving] = await membersOf(seedShowcaseWorkspace.id)

    await remove(seedShowcaseWorkspace.id, leaving!.id)

    expect(await memberCountOf(seedShowcaseWorkspace.id)).toBe(3)
  })

  it('answers 403 for an Admin who is not the Operator', async () => {
    server.use(...operatorHandlers(apiUrl, { session: sandboxAdminSession }))

    expect((await remove(seedShowcaseWorkspace.id, seedId(11, 4))).status).toBe(403)
  })
})

describe('createInvites', () => {
  it('generates hundreds of valid invites with unique emails for one Workspace', () => {
    const invites = createInvites({ count: 250, workspaceId: seedWorkspace.id })

    expect(invites).toHaveLength(250)
    expect(new Set(invites.map(({ email }) => email)).size).toBe(250)

    for (const invite of invites) {
      expect(inviteSchema.parse(invite)).toEqual(invite)
      expect(invite.workspaceId).toBe(seedWorkspace.id)
    }
  })
})

describe('GET /operator/workspaces/:workspaceId/invites', () => {
  it('lists the invites of one Workspace, newest first', async () => {
    server.use(...operatorHandlers(apiUrl))

    const response = await listInvites(seedWorkspace.id)
    const invites = workspaceInvitesEndpoint.response.parse(await response.json())

    expect(invites.length).toBeGreaterThan(0)
    expect(invites.every(({ workspaceId }) => workspaceId === seedWorkspace.id)).toBe(true)
    expect(invites.map(({ createdAt }) => createdAt)).toEqual(
      invites
        .map(({ createdAt }) => createdAt)
        .sort()
        .reverse(),
    )
  })

  it('seeds Admin and Viewer invites, accepted and pending', () => {
    const own = seedInvites.filter(({ workspaceId }) => workspaceId === seedWorkspace.id)

    expect(new Set(own.map(({ role }) => role))).toEqual(new Set(['admin', 'viewer']))
    expect(own.some(({ acceptedAt }) => acceptedAt === null)).toBe(true)
    expect(own.some(({ acceptedAt }) => acceptedAt !== null)).toBe(true)
  })

  it.each(['2026-10-20T08:00:00.000Z', '2027-06-01T08:00:00.000Z'])(
    'seeds one open and one expired invite when loaded on %s',
    async (today) => {
      vi.useFakeTimers({ now: new Date(today), toFake: ['Date'] })
      vi.resetModules()

      const { createOperatorStore, seedInvites } = await import('./operator')

      const unanswered = seedInvites.filter(isUnansweredSeedInvite)

      const expired = unanswered.filter(({ expiresAt }) => Date.parse(expiresAt) <= Date.now())

      const pendingCount = createOperatorStore()
        .workspaces()
        .find(({ id }) => id === seedWorkspace.id)?.pendingInviteCount

      expect(unanswered).toHaveLength(2)
      expect(expired).toHaveLength(1)
      expect(pendingCount).toBe(1)
    },
  )

  it('lists no invites for a Workspace without any', async () => {
    server.use(...operatorHandlers(apiUrl, { invites: [] }))

    const response = await listInvites(seedWorkspace.id)

    expect(await response.json()).toEqual([])
  })

  it('answers 404 for an unknown Workspace', async () => {
    server.use(...operatorHandlers(apiUrl))

    expect((await listInvites(unknownWorkspaceId)).status).toBe(404)
  })
})

describe('POST /operator/workspaces/:workspaceId/invites', () => {
  const invite: InviteInput = { email: 'jonas.weber@havelland.example', role: 'viewer' }

  it('creates a pending invite with a link to copy and lists it first', async () => {
    server.use(...operatorHandlers(apiUrl, { appUrl: 'https://app.test' }))

    const response = await post(
      toPath(createInviteEndpoint.path, { workspaceId: seedSandboxWorkspace.id }),
      invite,
    )

    const created = createInviteEndpoint.response.parse(await response.json())

    const [listed] = workspaceInvitesEndpoint.response.parse(
      await (await listInvites(seedSandboxWorkspace.id)).json(),
    )

    expect(response.status).toBe(201)
    expect(created).toMatchObject({
      ...invite,
      workspaceId: seedSandboxWorkspace.id,
      acceptedAt: null,
      revokedAt: null,
    })
    expect(created.link).toMatch(/^https:\/\/app\.test\/invite\/[\w-]{16,}$/)
    expect(Date.parse(created.expiresAt) - Date.parse(created.createdAt)).toBe(
      inviteValidityDays * dayMs,
    )
    expect(listed).toEqual(created)
  })

  it.each<[string, Partial<InviteInput>]>([
    ['an invalid email', { email: 'jonas', role: 'viewer' }],
    ['a missing role', { email: 'jonas.weber@havelland.example' }],
  ])('answers 400 for %s', async (_, body) => {
    server.use(...operatorHandlers(apiUrl))

    const response = await post(
      toPath(createInviteEndpoint.path, { workspaceId: seedWorkspace.id }),
      body,
    )

    expect(response.status).toBe(400)
  })

  it('answers 409 for someone who is already a Member of the Workspace', async () => {
    server.use(...operatorHandlers(apiUrl))

    const response = await post(
      toPath(createInviteEndpoint.path, { workspaceId: seedWorkspace.id }),
      { email: 'Mara.Olsen@nordwind-handel.example', role: 'viewer' },
    )

    expect(response.status).toBe(409)
  })

  it('answers 404 for an unknown Workspace', async () => {
    server.use(...operatorHandlers(apiUrl))

    const response = await post(
      toPath(createInviteEndpoint.path, { workspaceId: unknownWorkspaceId }),
      invite,
    )

    expect(response.status).toBe(404)
  })

  it('answers 403 for an Admin who is not the Operator', async () => {
    server.use(...operatorHandlers(apiUrl, { session: sandboxAdminSession }))

    const response = await post(
      toPath(createInviteEndpoint.path, { workspaceId: seedSandboxWorkspace.id }),
      invite,
    )

    expect(response.status).toBe(403)
  })
})

function pendingInviteCountOf(workspaces: ReadonlyArray<WorkspaceSummary>, id: string) {
  return workspaces.find((workspace) => workspace.id === id)?.pendingInviteCount
}

describe('DELETE /operator/workspaces/:workspaceId/invites/:inviteId', () => {
  const pending = seedInvites.find(isUnansweredSeedInvite)!

  const accepted = seedInvites.find(
    ({ workspaceId, acceptedAt }) => workspaceId === seedWorkspace.id && acceptedAt !== null,
  )!

  const revoke = (workspaceId: string, inviteId: string) =>
    fetch(`${apiUrl}${toPath(revokeInviteEndpoint.path, { workspaceId, inviteId })}`, {
      method: 'DELETE',
    })

  it('revokes a pending invite, drops it from the list and the pending count', async () => {
    server.use(...operatorHandlers(apiUrl))
    const before = Date.now()

    const response = await revoke(seedWorkspace.id, pending.id)
    const revoked = revokeInviteEndpoint.response.parse(await response.json())

    const listed = workspaceInvitesEndpoint.response.parse(
      await (await listInvites(seedWorkspace.id)).json(),
    )

    expect(response.status).toBe(200)
    expect(revoked).toMatchObject({ id: pending.id, acceptedAt: null })
    expect(Date.parse(revoked.revokedAt!)).toBeGreaterThanOrEqual(before)
    expect(listed.map(({ id }) => id)).not.toContain(pending.id)
    expect(pendingInviteCountOf(await listWorkspaces(), seedWorkspace.id)).toBe(0)
  })

  it('answers 409 for an accepted invite', async () => {
    server.use(...operatorHandlers(apiUrl))

    expect((await revoke(seedWorkspace.id, accepted.id)).status).toBe(409)
  })

  it('answers 404 for an invite revoked before', async () => {
    server.use(...operatorHandlers(apiUrl))

    await revoke(seedWorkspace.id, pending.id)

    expect((await revoke(seedWorkspace.id, pending.id)).status).toBe(404)
  })

  it.each([
    ['an unknown invite', seedWorkspace.id, unknownWorkspaceId],
    ['an invite of another Workspace', seedSandboxWorkspace.id, pending.id],
    ['an unknown Workspace', unknownWorkspaceId, pending.id],
  ])('answers 404 for %s', async (_, workspaceId, inviteId) => {
    server.use(...operatorHandlers(apiUrl))

    expect((await revoke(workspaceId, inviteId)).status).toBe(404)
  })

  it('answers 403 for an Admin who is not the Operator', async () => {
    server.use(...operatorHandlers(apiUrl, { session: sandboxAdminSession }))

    expect((await revoke(seedWorkspace.id, pending.id)).status).toBe(403)
  })

  it('counts a created invite as pending', async () => {
    server.use(...operatorHandlers(apiUrl))

    await post(toPath(createInviteEndpoint.path, { workspaceId: seedSandboxWorkspace.id }), {
      email: 'jonas.weber@havelland.example',
      role: 'admin',
    })

    expect(pendingInviteCountOf(await listWorkspaces(), seedSandboxWorkspace.id)).toBe(1)
  })
})

describe('pending invite count', () => {
  const pending = seedInvites.find(
    (invite) => isUnansweredSeedInvite(invite) && Date.parse(invite.expiresAt) > Date.now(),
  )!

  const beforeSeedExpiry = new Date(Date.parse(pending.expiresAt) - 1)
  const afterSeedExpiry = new Date(pending.expiresAt)

  it('counts the pending invites of each seed Workspace', async () => {
    server.use(...operatorHandlers(apiUrl, { now: () => beforeSeedExpiry }))

    const workspaces = await listWorkspaces()

    expect(
      Object.fromEntries(workspaces.map(({ id, pendingInviteCount }) => [id, pendingInviteCount])),
    ).toEqual({
      [seedWorkspace.id]: 1,
      [seedShowcaseWorkspace.id]: 0,
      [seedSandboxWorkspace.id]: 0,
    })
  })

  it('does not count an expired invite as pending', async () => {
    server.use(...operatorHandlers(apiUrl, { now: () => afterSeedExpiry }))

    expect(pendingInviteCountOf(await listWorkspaces(), seedWorkspace.id)).toBe(0)
  })

  it('revokes an expired invite without counting it as pending', async () => {
    server.use(...operatorHandlers(apiUrl, { now: () => afterSeedExpiry }))

    const response = await fetch(
      `${apiUrl}${toPath(revokeInviteEndpoint.path, { workspaceId: seedWorkspace.id, inviteId: pending.id })}`,
      { method: 'DELETE' },
    )

    expect(response.status).toBe(200)
    expect(pendingInviteCountOf(await listWorkspaces(), seedWorkspace.id)).toBe(0)
  })

  it('derives the count from hundreds of generated invites', async () => {
    const now = new Date('2026-10-12T08:00:00.000Z')
    const invites = createInvites({ count: 200, workspaceId: seedWorkspace.id, now })
    server.use(...operatorHandlers(apiUrl, { invites, now: () => now }))

    const listed = workspaceInvitesEndpoint.response.parse(
      await (await listInvites(seedWorkspace.id)).json(),
    )

    const unansweredInLastWeek = invites.filter(
      ({ acceptedAt, createdAt }) =>
        acceptedAt === null && now.getTime() - Date.parse(createdAt) < inviteValidityDays * dayMs,
    )

    expect(listed).toHaveLength(200)
    expect(pendingInviteCountOf(await listWorkspaces(), seedWorkspace.id)).toBe(
      unansweredInLastWeek.length,
    )
  })
})

describe('POST /invites/accept', () => {
  const pending = seedInvites.find(
    (invite) => isUnansweredSeedInvite(invite) && Date.parse(invite.expiresAt) > Date.now(),
  )!

  const expired = seedInvites.find(
    (invite) => isUnansweredSeedInvite(invite) && Date.parse(invite.expiresAt) <= Date.now(),
  )!

  const accepted = seedInvites.find(({ acceptedAt }) => acceptedAt !== null)!

  const tokenOf = ({ link }: Invite) => new URL(link).pathname.split('/').at(-1)!

  const accept = (token: string, password = 'invited-password') =>
    fetch(`${apiUrl}${acceptInviteEndpoint.path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token, name: 'Jan Petersen', password }),
    })

  const createInvite = async (workspaceId: string, body: InviteInput) =>
    inviteSchema.parse(
      await (await post(toPath(createInviteEndpoint.path, { workspaceId }), body)).json(),
    )

  const membersOf = async (workspaceId: string) =>
    operatorWorkspaceMembersEndpoint.response.parse(await (await listMembers(workspaceId)).json())

  it('accepts a pending invite without a session and marks it accepted', async () => {
    const store = createOperatorStore()
    server.use(...operatorHandlers(apiUrl, { workspaces: store, session: null }))

    const response = await accept(tokenOf(pending))

    expect(response.status).toBe(200)
    expect(store.invite(seedWorkspace.id, pending.id)?.acceptedAt).toEqual(expect.any(String))
  })

  it.each([
    ['a used', accepted, 'used'],
    ['an expired', expired, 'expired'],
  ] as const)('answers %s link with the unusable status', async (_, invite, reason) => {
    server.use(...operatorHandlers(apiUrl, { session: null }))

    const response = await accept(tokenOf(invite))

    expect(response.status).toBe(inviteUnusableStatus)
    expect(await response.json()).toEqual(inviteUnusableProblem(reason))
  })

  it('answers a revoked link with the unusable status', async () => {
    server.use(...operatorHandlers(apiUrl))

    await fetch(
      `${apiUrl}${toPath(revokeInviteEndpoint.path, { workspaceId: seedWorkspace.id, inviteId: pending.id })}`,
      { method: 'DELETE' },
    )

    const response = await accept(tokenOf(pending))

    expect(response.status).toBe(inviteUnusableStatus)
    expect(await response.json()).toEqual(inviteUnusableProblem('revoked'))
  })

  it('adds a new user as a Member with the role of the invite', async () => {
    server.use(...operatorHandlers(apiUrl))

    const invite = await createInvite(seedSandboxWorkspace.id, {
      email: 'jonas.weber@havelland.example',
      role: 'viewer',
    })

    const response = await accept(tokenOf(invite))
    const workspace = (await listWorkspaces()).find(({ id }) => id === seedSandboxWorkspace.id)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ email: 'jonas.weber@havelland.example' })
    expect(
      (await membersOf(seedSandboxWorkspace.id)).map(({ email, role }) => ({ email, role })),
    ).toEqual([
      { email: mockCredentials.sandboxAdmin.email, role: 'admin' },
      { email: 'jonas.weber@havelland.example', role: 'viewer' },
    ])
    expect(workspace?.memberCount).toBe(2)
  })

  it('lets a new user sign in with the password set through the invite', async () => {
    const session = createSessionStore()
    const accounts = createAccountStore()

    server.use(
      ...sessionHandlers(apiUrl, session, accounts),
      ...operatorHandlers(apiUrl, { session, accounts }),
    )

    const invite = await createInvite(seedSandboxWorkspace.id, {
      email: 'jonas.weber@havelland.example',
      role: 'viewer',
    })

    await accept(tokenOf(invite), 'jonas-password')

    const signIn = await fetch(`${apiUrl}${signInEndpoint.path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'jonas.weber@havelland.example', password: 'jonas-password' }),
    })

    expect(signIn.status).toBe(200)
    expect(
      sessionSchema.parse(await (await fetch(`${apiUrl}${sessionEndpoint.path}`)).json()),
    ).toMatchObject({
      user: { name: 'Jan Petersen', email: 'jonas.weber@havelland.example' },
      operator: false,
      workspace: { id: seedSandboxWorkspace.id, name: seedSandboxWorkspace.name, kind: 'sandbox' },
      role: 'viewer',
    })
  })

  it('counts the Members from the member list after an accept', async () => {
    const workspaces = seedWorkspaceSummaries.map((workspace) => ({
      ...workspace,
      memberCount: 40,
    }))

    server.use(...operatorHandlers(apiUrl, { workspaces }))

    const invite = await createInvite(seedSandboxWorkspace.id, {
      email: 'jonas.weber@havelland.example',
      role: 'viewer',
    })

    await accept(tokenOf(invite))
    const workspace = (await listWorkspaces()).find(({ id }) => id === seedSandboxWorkspace.id)

    expect(workspace?.memberCount).toBe(2)
  })

  it('adds an existing user to the Workspace when their password matches', async () => {
    server.use(...operatorHandlers(apiUrl))

    const invite = await createInvite(seedWorkspace.id, {
      email: mockCredentials.sandboxAdmin.email,
      role: 'viewer',
    })

    const response = await accept(tokenOf(invite), mockCredentials.sandboxAdmin.password)

    expect(response.status).toBe(200)
    expect((await membersOf(seedWorkspace.id)).map(({ email }) => email)).toContain(
      mockCredentials.sandboxAdmin.email,
    )
  })

  it.each([
    ['an account with a known password', mockCredentials.sandboxAdmin.email],
    ['a Member of another Workspace', 'clara.weidner@lindenhof-feinkost.example'],
  ])('answers 403 to %s on a wrong password and keeps the link open', async (_, email) => {
    const store = createOperatorStore()
    server.use(...operatorHandlers(apiUrl, { workspaces: store }))

    const invite = await createInvite(seedWorkspace.id, { email, role: 'admin' })

    const response = await accept(tokenOf(invite), 'takeover-password')

    expect(response.status).toBe(403)
    expect(store.invite(seedWorkspace.id, invite.id)?.acceptedAt).toBeNull()
    expect((await membersOf(seedWorkspace.id)).map((member) => member.email)).not.toContain(email)
  })

  it('keeps the role of someone who became a Member after the invite was created', async () => {
    const invite = inviteSchema.parse({
      id: '5d0f3c1e-8a4b-4e6f-9b2d-1c7a3e5f9d09',
      workspaceId: seedSandboxWorkspace.id,
      email: mockCredentials.sandboxAdmin.email,
      role: 'viewer',
      link: 'http://localhost:3000/invite/became-admin',
      createdAt: new Date(Date.now() - dayMs).toISOString(),
      expiresAt: new Date(Date.now() + dayMs).toISOString(),
      acceptedAt: null,
      revokedAt: null,
    })

    const store = createOperatorStore({ invites: [invite] })
    server.use(...operatorHandlers(apiUrl, { workspaces: store }))

    const response = await accept('became-admin', mockCredentials.sandboxAdmin.password)

    expect(response.status).toBe(200)
    expect(store.invite(seedSandboxWorkspace.id, invite.id)?.acceptedAt).toEqual(expect.any(String))
    expect(
      (await membersOf(seedSandboxWorkspace.id)).map(({ email, role }) => ({ email, role })),
    ).toEqual([{ email: mockCredentials.sandboxAdmin.email, role: 'admin' }])
  })

  it('answers 404 for an unknown token', async () => {
    server.use(...operatorHandlers(apiUrl, { session: null }))

    expect((await accept('unknown-token')).status).toBe(404)
  })

  it('answers 400 for a password shorter than 8 characters', async () => {
    server.use(...operatorHandlers(apiUrl, { session: null }))

    expect((await accept(tokenOf(pending), 'short')).status).toBe(400)
  })
})

describe('POST /operator/workspaces/:workspaceId/reset', () => {
  const reset = (workspaceId: string) =>
    post(toPath(resetSandboxWorkspaceEndpoint.path, { workspaceId }))

  it('resets the Sandbox Workspace and records when', async () => {
    server.use(...operatorHandlers(apiUrl))
    const before = Date.now()

    const response = await reset(seedSandboxWorkspace.id)
    const workspace = resetSandboxWorkspaceEndpoint.response.parse(await response.json())
    const listed = (await listWorkspaces()).find(({ id }) => id === seedSandboxWorkspace.id)

    expect(response.status).toBe(200)
    expect(workspace).toMatchObject({ id: seedSandboxWorkspace.id, kind: 'sandbox' })
    expect(Date.parse(workspace.lastResetAt!)).toBeGreaterThanOrEqual(before)
    expect(listed).toEqual(workspace)
  })

  it.each([
    ['a standard Workspace', seedWorkspace.id],
    ['the Showcase Workspace', seedShowcaseWorkspace.id],
  ])('answers 409 for %s', async (_, workspaceId) => {
    server.use(...operatorHandlers(apiUrl))

    expect((await reset(workspaceId)).status).toBe(409)
  })

  it('answers 404 for an unknown Workspace', async () => {
    server.use(...operatorHandlers(apiUrl))

    expect((await reset(unknownWorkspaceId)).status).toBe(404)
  })

  it('answers 403 for the showcase-admin, Admin of the Sandbox Workspace', async () => {
    server.use(...operatorHandlers(apiUrl, { session: sandboxAdminSession }))

    expect((await reset(seedSandboxWorkspace.id)).status).toBe(403)
  })
})
