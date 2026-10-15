import { hashPassword } from 'better-auth/crypto'

import type { InjectOptions, LightMyRequestResponse } from 'fastify'

import { signInEndpoint, type WorkspaceRole } from '@edi-bridge/contracts'
import { connect, members, workspaces } from '@edi-bridge/db'
import { startTestDatabase } from '@edi-bridge/db/testing'

import { buildApp } from './app.js'
import { developmentWorkspace } from './development-workspace.js'
import { secretKeyBytes } from './secret.js'
import { addUser, storePassword } from './user.js'

import type { AuthSettings } from './auth.js'
import type { ChannelSettings } from './channel.js'
import type { Database } from './db.js'

export const ownWorkspace = { ...developmentWorkspace, gln: null }

export const otherWorkspace = {
  id: '8b2d6e14-3f9a-4c57-a0d8-71e5b9c4f236',
  name: 'Sudhafen Logistik AG',
  gln: null,
}

export const webOrigin = 'http://localhost:3000'

export const testAuth: AuthSettings = {
  secret: 'test-secret-that-is-at-least-32-characters-long',
  baseUrl: 'http://localhost:3001',
  trustedOrigins: [webOrigin],
}

export const testChannels: ChannelSettings = {
  secretKey: Buffer.alloc(secretKeyBytes, 'test-channel-secret-key'),
  apiPublicUrl: 'http://localhost:3001',
  connectionTimeoutMs: 1500,
}

const up = () => Promise.resolve()

export interface Credentials {
  email: string
  password: string
}

export interface Client {
  inject: (options: InjectOptions) => Promise<LightMyRequestResponse>
}

export interface NewMember extends Credentials {
  name: string
  workspaceId: string
  role: WorkspaceRole
  operator?: boolean
}

export async function addMember(database: Database, member: NewMember) {
  const userId = await addUser(database, {
    name: member.name,
    email: member.email,
    operator: member.operator ?? false,
  })

  await storePassword(database, userId, await hashPassword(member.password))
  await database
    .insert(members)
    .values({ userId, workspaceId: member.workspaceId, role: member.role })

  return userId
}

export const signInRequest = ({ email, password }: Credentials): InjectOptions => ({
  method: 'POST',
  url: signInEndpoint.path,
  headers: { origin: webOrigin },
  body: { email, password },
})

export async function signIn(app: Client, credentials: Credentials): Promise<Client> {
  const response = await app.inject(signInRequest(credentials))

  if (response.statusCode !== 200) {
    throw new Error(`Sign-in failed with status ${response.statusCode}: ${response.body}`)
  }

  const cookie = response.cookies.map(({ name, value }) => `${name}=${value}`).join('; ')

  return {
    inject: (options) =>
      app.inject({ ...options, headers: { origin: webOrigin, ...options.headers, cookie } }),
  }
}

export const ownAdmin: NewMember = {
  name: 'Nordwind Admin',
  email: 'admin@nordwind.example',
  password: 'nordwind-admin-password',
  workspaceId: ownWorkspace.id,
  role: 'admin',
}

export const ownViewer: NewMember = {
  name: 'Nordwind Viewer',
  email: 'viewer@nordwind.example',
  password: 'nordwind-viewer-password',
  workspaceId: ownWorkspace.id,
  role: 'viewer',
}

export const otherAdmin: NewMember = {
  name: 'Sudhafen Admin',
  email: 'admin@sudhafen.example',
  password: 'sudhafen-admin-password',
  workspaceId: otherWorkspace.id,
  role: 'admin',
}

export async function startTestApi() {
  const testDatabase = await startTestDatabase()
  const connection = connect(testDatabase.url)

  await connection.db.insert(workspaces).values([ownWorkspace, otherWorkspace])
  await addMember(connection.db, ownAdmin)
  await addMember(connection.db, ownViewer)
  await addMember(connection.db, otherAdmin)

  const app = buildApp({
    auth: testAuth,
    channels: testChannels,
    database: connection.db,
    probes: { postgres: up, redis: up },
    webOrigin,
  })

  return {
    app,
    connection,
    databaseUrl: testDatabase.url,
    admin: await signIn(app, ownAdmin),
    viewer: await signIn(app, ownViewer),
    otherAdmin: await signIn(app, otherAdmin),
    stop: async () => {
      await app.close()
      await connection.close()
      await testDatabase.stop()
    },
  }
}

export type TestApi = Awaited<ReturnType<typeof startTestApi>>
