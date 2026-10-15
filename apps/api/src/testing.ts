import { hashPassword } from 'better-auth/crypto'

import type { InjectOptions, LightMyRequestResponse } from 'fastify'

import { signInEndpoint, type WorkspaceRole } from '@edi-bridge/contracts'
import { accounts, connect, members, users, workspaces } from '@edi-bridge/db'
import { startTestDatabase } from '@edi-bridge/db/testing'

import { buildApp } from './app.js'

import type { AuthSettings } from './auth.js'
import type { Database } from './db.js'

export const ownWorkspace = {
  id: '5f0c3a52-7d1e-4b8a-9c61-2e4f8d9a1b07',
  name: 'Nordwind Handel GmbH',
  gln: null,
}

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

const up = () => Promise.resolve()

export interface Credentials {
  email: string
  password: string
}

export interface Client {
  inject: (options: InjectOptions) => Promise<LightMyRequestResponse>
}

export interface Member extends Credentials {
  name: string
  workspaceId: string
  role: WorkspaceRole
  operator?: boolean
}

export async function addMember(database: Database, member: Member) {
  const [user] = await database
    .insert(users)
    .values({
      name: member.name,
      email: member.email,
      emailVerified: true,
      operator: member.operator ?? false,
    })
    .returning({ id: users.id })

  if (user === undefined) {
    throw new Error('User insert returned no row')
  }

  await database.insert(accounts).values({
    userId: user.id,
    accountId: user.id,
    providerId: 'credential',
    password: await hashPassword(member.password),
  })

  await database
    .insert(members)
    .values({ userId: user.id, workspaceId: member.workspaceId, role: member.role })

  return user
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

export const ownAdmin: Member = {
  name: 'Nordwind Admin',
  email: 'admin@nordwind.example',
  password: 'nordwind-admin-password',
  workspaceId: ownWorkspace.id,
  role: 'admin',
}

export const otherAdmin: Member = {
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
  await addMember(connection.db, otherAdmin)

  const app = buildApp({
    auth: testAuth,
    database: connection.db,
    probes: { postgres: up, redis: up },
  })

  return {
    app,
    connection,
    databaseUrl: testDatabase.url,
    admin: await signIn(app, ownAdmin),
    otherAdmin: await signIn(app, otherAdmin),
    stop: async () => {
      await app.close()
      await connection.close()
      await testDatabase.stop()
    },
  }
}

export type TestApi = Awaited<ReturnType<typeof startTestApi>>
