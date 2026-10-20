import { hashPassword } from 'better-auth/crypto'
import { and, count, eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

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

import { ensureShowcaseAndSandbox, showcaseAdmin, showcaseViewer } from './showcase-and-sandbox.js'
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
import { storePassword } from './user.js'

let api: TestApi

const adminPassword = 'sandbox-admin-password'

const ensure = (password: string | undefined) =>
  ensureShowcaseAndSandbox(api.connection.db, {
    secrets: secretBox(testChannels.secretKey),
    adminPassword: password,
  })

const adminSignIn = (password = adminPassword) =>
  api.app.inject(signInRequest({ email: showcaseAdmin.email, password }))

const showcaseSignIn = (headers: Record<string, string> = { origin: webOrigin }) =>
  api.app.inject({ method: 'POST', url: showcaseSignInEndpoint.path, headers })

const sessionOf = async (client: Client) =>
  sessionSchema.parse((await client.inject({ method: 'GET', url: sessionEndpoint.path })).json())

const userIdOf = async (email: string) => {
  const [user] = await api.connection.db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))

  if (user === undefined) {
    throw new Error(`${email} is missing`)
  }

  return user.id
}

const membershipsOf = (userId: string) =>
  api.connection.db
    .select({ workspaceId: members.workspaceId, role: members.role })
    .from(members)
    .where(eq(members.userId, userId))

const showcaseId = async () => {
  const [showcase] = await api.connection.db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(eq(workspaces.kind, 'showcase'))

  if (showcase === undefined) {
    throw new Error('The Showcase is missing')
  }

  return showcase.id
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

describe('POST /auth/sign-in/showcase before the Showcase and Sandbox exist', () => {
  it('answers 404 and creates no session', async () => {
    const response = await showcaseSignIn()

    expect(response.statusCode).toBe(404)
    expect(response.cookies).toEqual([])
  })
})

describe('api start', () => {
  it('creates no Showcase or Sandbox Workspace', async () => {
    const kinds = await api.connection.db.select({ kind: workspaces.kind }).from(workspaces)

    expect(kinds.map(({ kind }) => kind)).not.toContain('showcase')
    expect(kinds.map(({ kind }) => kind)).not.toContain('sandbox')
  })
})

describe('ensureShowcaseAndSandbox', () => {
  it('creates the seeded Showcase and Sandbox with their fixed users once', async () => {
    expect(await ensure(adminPassword)).toEqual({
      showcase: 'created',
      sandbox: 'created',
      viewer: 'created',
      admin: 'created',
      generatedPassword: null,
    })

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

  it('changes nothing when run again: no new seed, no new password', async () => {
    const before = { showcase: await runCount('showcase'), sandbox: await runCount('sandbox') }
    expect(await ensure('another-sandbox-password')).toEqual({
      showcase: 'found',
      sandbox: 'found',
      viewer: 'found',
      admin: 'found',
      generatedPassword: null,
    })
    expect({ showcase: await runCount('showcase'), sandbox: await runCount('sandbox') }).toEqual(
      before,
    )
    expect((await adminSignIn()).statusCode).toBe(200)
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
        name: 'Besucher GmbH',
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
    const userId = await userIdOf(showcaseViewer.email)

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
    const userId = await userIdOf(showcaseViewer.email)

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
    const userId = await userIdOf(showcaseViewer.email)

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

describe('ensureShowcaseAndSandbox run again after a change', () => {
  it('adds the missing memberships of the Viewer and the Admin', async () => {
    const userIds = [await userIdOf(showcaseViewer.email), await userIdOf(showcaseAdmin.email)]

    await api.connection.db.delete(members).where(inArray(members.userId, userIds))

    expect(await ensure('another-sandbox-password')).toMatchObject({
      viewer: 'membershipAdded',
      admin: 'membershipAdded',
      generatedPassword: null,
    })
    expect(await sessionOf(signedInClient(api.app, await showcaseSignIn()))).toMatchObject({
      workspace: { kind: 'showcase' },
      role: 'viewer',
    })
    expect(await sessionOf(signedInClient(api.app, await adminSignIn()))).toMatchObject({
      workspace: { kind: 'sandbox' },
      role: 'admin',
    })
  })

  it('creates a missing showcase-admin with a generated password it returns', async () => {
    await api.connection.db.delete(users).where(eq(users.email, showcaseAdmin.email))

    const outcome = await ensure(undefined)

    expect(outcome).toMatchObject({ viewer: 'found', admin: 'created' })
    expect(outcome.generatedPassword).toEqual(expect.any(String))
    expect((await adminSignIn(outcome.generatedPassword ?? '')).statusCode).toBe(200)

    await storePassword(
      api.connection.db,
      await userIdOf(showcaseAdmin.email),
      await hashPassword(adminPassword),
    )
  })

  it('grants nothing and fails when the Viewer is an Operator', async () => {
    const userId = await userIdOf(showcaseViewer.email)

    await api.connection.db.delete(members).where(eq(members.userId, userId))
    await api.connection.db.update(users).set({ operator: true }).where(eq(users.id, userId))

    try {
      await expect(ensure(adminPassword)).rejects.toThrow(
        `${showcaseViewer.email} has rights beyond the Viewer of the Showcase`,
      )
      expect(await membershipsOf(userId)).toEqual([])
    } finally {
      await api.connection.db.update(users).set({ operator: false }).where(eq(users.id, userId))
      await ensure(adminPassword)
    }
  })

  it('grants nothing and fails when the showcase-admin is Member of another Workspace', async () => {
    const userId = await userIdOf(showcaseAdmin.email)

    await api.connection.db.delete(members).where(eq(members.userId, userId))
    await api.connection.db
      .insert(members)
      .values({ userId, workspaceId: ownWorkspace.id, role: 'viewer' })

    try {
      await expect(ensure(adminPassword)).rejects.toThrow(
        `${showcaseAdmin.email} has rights beyond the Admin of the Sandbox`,
      )
      expect(await membershipsOf(userId)).toEqual([
        { workspaceId: ownWorkspace.id, role: 'viewer' },
      ])
    } finally {
      await api.connection.db.delete(members).where(eq(members.userId, userId))
      await ensure(adminPassword)
    }
  })

  it('keeps a changed role of the Viewer in the Showcase and fails', async () => {
    const userId = await userIdOf(showcaseViewer.email)

    await api.connection.db.update(members).set({ role: 'admin' }).where(eq(members.userId, userId))

    try {
      await expect(ensure(adminPassword)).rejects.toThrow(
        `${showcaseViewer.email} has rights beyond the Viewer of the Showcase`,
      )
      expect(await membershipsOf(userId)).toEqual([
        { workspaceId: await showcaseId(), role: 'admin' },
      ])
    } finally {
      await api.connection.db
        .update(members)
        .set({ role: 'viewer' })
        .where(eq(members.userId, userId))
    }
  })
})
