import { count, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { secretBox } from '@edi-bridge/channels'
import { sessionEndpoint, sessionSchema } from '@edi-bridge/contracts'
import { runs, workspaces } from '@edi-bridge/db'

import { ensureDemoWorkspaces, showcaseAdmin, showcaseViewer } from './demo-workspaces.js'
import {
  type Client,
  signIn,
  signInRequest,
  startTestApi,
  type TestApi,
  testChannels,
} from './testing.js'

let api: TestApi

const adminPassword = 'sandbox-admin-password'

const ensure = (password = vi.fn(() => adminPassword)) =>
  ensureDemoWorkspaces(api.connection.db, {
    secrets: secretBox(testChannels.secretKey),
    adminPassword: password,
  })

const sessionOf = async (client: Client) =>
  sessionSchema.parse((await client.inject({ method: 'GET', url: sessionEndpoint.path })).json())

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
