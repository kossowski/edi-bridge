import { and, count, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { secretBox } from '@edi-bridge/channels'
import {
  createTradingPartnerEndpoint,
  operatorWorkspacesEndpoint,
  sessionEndpoint,
  sessionSchema,
  showcaseSignInEndpoint,
  signedInSchema,
} from '@edi-bridge/contracts'
import { members, runs, users, workspaces } from '@edi-bridge/db'

import { ensureDemoWorkspaces, showcaseAdmin, showcaseViewer } from './demo-workspaces.js'
import {
  type Client,
  ownWorkspace,
  signIn,
  signInRequest,
  signedInClient,
  startTestApi,
  type TestApi,
  testChannels,
  webOrigin,
} from './testing.js'

let api: TestApi

const adminPassword = 'sandbox-admin-password'

const ensure = (password = vi.fn(() => adminPassword)) =>
  ensureDemoWorkspaces(api.connection.db, {
    secrets: secretBox(testChannels.secretKey),
    adminPassword: password,
  })

const showcaseSignIn = (headers: Record<string, string> = { origin: webOrigin }) =>
  api.app.inject({ method: 'POST', url: showcaseSignInEndpoint.path, headers })

const sessionOf = async (client: Client) =>
  sessionSchema.parse((await client.inject({ method: 'GET', url: sessionEndpoint.path })).json())

const viewerId = async () => {
  const [viewer] = await api.connection.db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, showcaseViewer.email))

  if (viewer === undefined) {
    throw new Error('The showcase Viewer is missing')
  }

  return viewer.id
}

const runCount = async (kind: 'showcase' | 'sandbox') => {
  const [row] = await api.connection.db
    .select({ count: count() })
    .from(runs)
    .innerJoin(workspaces, eq(workspaces.id, runs.workspaceId))
    .where(eq(workspaces.kind, kind))

  return row?.count ?? 0
}

beforeAll(async () => {
  api = await startTestApi()
}, 60_000)

afterAll(async () => {
  await api.stop()
})

describe('POST /auth/sign-in/showcase before the demo Workspaces exist', () => {
  it('answers 404 and creates no session', async () => {
    const response = await showcaseSignIn()

    expect(response.statusCode).toBe(404)
    expect(response.cookies).toEqual([])
  })
})

describe('api start', () => {
  it('creates no demo Workspace', async () => {
    const kinds = await api.connection.db.select({ kind: workspaces.kind }).from(workspaces)

    expect(kinds.map(({ kind }) => kind)).not.toContain('showcase')
    expect(kinds.map(({ kind }) => kind)).not.toContain('sandbox')
  })
})

describe('ensureDemoWorkspaces', () => {
  it('creates the seeded Showcase and Sandbox with their fixed users once', async () => {
    const password = vi.fn(() => adminPassword)

    expect(await ensure(password)).toEqual({
      showcase: 'created',
      sandbox: 'created',
      viewer: 'created',
      admin: 'created',
    })
    expect(password).toHaveBeenCalledOnce()

    const created = await api.connection.db
      .select({ name: workspaces.name, kind: workspaces.kind, seeded: workspaces.seeded })
      .from(workspaces)
      .where(eq(workspaces.seeded, true))

    expect(created).toEqual(
      expect.arrayContaining([
        { name: 'Lindenhof Feinkost GmbH', kind: 'showcase', seeded: true },
        { name: 'Kranichsee Getränke GmbH', kind: 'sandbox', seeded: true },
      ]),
    )
    expect(await runCount('showcase')).toBeGreaterThan(0)
    expect(await runCount('sandbox')).toBeGreaterThan(0)
  })

  it('makes the showcase-admin Admin of the Sandbox only, never Operator', async () => {
    const admin = await signIn(api.app, { email: showcaseAdmin.email, password: adminPassword })

    expect(await sessionOf(admin)).toMatchObject({
      user: { email: showcaseAdmin.email },
      operator: false,
      workspace: { name: 'Kranichsee Getränke GmbH', kind: 'sandbox' },
      role: 'admin',
    })
  })

  it('gives the Viewer no password to sign in with', async () => {
    const response = await api.app.inject(
      signInRequest({ email: showcaseViewer.email, password: adminPassword }),
    )

    expect(response.statusCode).toBe(401)
  })

  it('changes nothing on a rerun: no reseed, no new password', async () => {
    const before = { showcase: await runCount('showcase'), sandbox: await runCount('sandbox') }
    const password = vi.fn(() => 'another-sandbox-password')

    expect(await ensure(password)).toEqual({
      showcase: 'found',
      sandbox: 'found',
      viewer: 'found',
      admin: 'found',
    })
    expect(password).not.toHaveBeenCalled()
    expect({ showcase: await runCount('showcase'), sandbox: await runCount('sandbox') }).toEqual(
      before,
    )
    expect(
      (await api.app.inject(signInRequest({ email: showcaseAdmin.email, password: adminPassword })))
        .statusCode,
    ).toBe(200)
  })
})

describe('POST /auth/sign-in/showcase', () => {
  it('signs in the read-only Viewer of the Showcase', async () => {
    const response = await showcaseSignIn()

    expect(signedInSchema.parse(response.json()).user.email).toBe(showcaseViewer.email)
    expect(await sessionOf(signedInClient(api.app, response))).toMatchObject({
      user: { name: showcaseViewer.name, email: showcaseViewer.email },
      operator: false,
      workspace: { name: 'Lindenhof Feinkost GmbH', kind: 'showcase' },
      role: 'viewer',
    })
  })

  it('lets the Viewer change nothing', async () => {
    const viewer = signedInClient(api.app, await showcaseSignIn())

    const response = await viewer.inject({
      method: 'POST',
      url: createTradingPartnerEndpoint.path,
      body: {
        name: 'Demo Besucher GmbH',
        gln: null,
        characterSet: 'UNOC',
        acknowledgementTimeLimitHours: 24,
      },
    })

    expect(response.statusCode).toBe(403)
  })

  it('keeps the Operator routes closed to the Viewer', async () => {
    const viewer = signedInClient(api.app, await showcaseSignIn())

    expect(
      (await viewer.inject({ method: 'GET', url: operatorWorkspacesEndpoint.path })).statusCode,
    ).toBe(403)
  })

  it('refuses a request from a foreign origin', async () => {
    const response = await showcaseSignIn({ origin: 'https://attacker.example' })

    expect(response.statusCode).toBe(403)
    expect(response.cookies).toEqual([])
  })

  it('refuses once the Viewer is also Member of another Workspace', async () => {
    const userId = await viewerId()

    await api.connection.db
      .insert(members)
      .values({ userId, workspaceId: ownWorkspace.id, role: 'viewer' })

    try {
      const response = await showcaseSignIn()

      expect(response.statusCode).toBe(403)
      expect(response.cookies).toEqual([])
    } finally {
      await api.connection.db
        .delete(members)
        .where(and(eq(members.userId, userId), eq(members.workspaceId, ownWorkspace.id)))
    }
  })

  it('refuses once the Viewer holds a role above Viewer', async () => {
    const userId = await viewerId()

    await api.connection.db.update(members).set({ role: 'admin' }).where(eq(members.userId, userId))

    try {
      expect((await showcaseSignIn()).statusCode).toBe(403)
    } finally {
      await api.connection.db
        .update(members)
        .set({ role: 'viewer' })
        .where(eq(members.userId, userId))
    }
  })

  it('refuses once the Viewer is an Operator', async () => {
    const userId = await viewerId()

    await api.connection.db.update(users).set({ operator: true }).where(eq(users.id, userId))

    try {
      const response = await showcaseSignIn()

      expect(response.statusCode).toBe(403)
      expect(response.cookies).toEqual([])
    } finally {
      await api.connection.db.update(users).set({ operator: false }).where(eq(users.id, userId))
    }
  })
})
