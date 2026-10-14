import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { FastifyInstance } from 'fastify'

import { sessionEndpoint, sessionSchema } from '@edi-bridge/contracts'
import { connect, type Connection, workspaces } from '@edi-bridge/db'
import { startTestDatabase, type TestDatabase } from '@edi-bridge/db/testing'

import { buildApp } from './app.js'
import { otherWorkspace } from './testing.js'
import { seedDevelopmentWorkspace } from './workspace.js'

const up = () => Promise.resolve()

let testDatabase: TestDatabase

let connection: Connection

let app: FastifyInstance

let otherApp: FastifyInstance

beforeAll(async () => {
  testDatabase = await startTestDatabase()
  connection = connect(testDatabase.url)
  await seedDevelopmentWorkspace(connection.db)
  await connection.db.insert(workspaces).values(otherWorkspace)
  app = buildApp({ database: connection.db, probes: { postgres: up, redis: up } })
  otherApp = buildApp({
    database: connection.db,
    probes: { postgres: up, redis: up },
    resolveWorkspace: () => otherWorkspace.id,
  })
}, 60_000)

afterAll(async () => {
  await app.close()
  await otherApp.close()
  await connection.close()
  await testDatabase.stop()
})

const getSession = (target = app) => target.inject({ method: 'GET', url: sessionEndpoint.path })

describe('GET /session', () => {
  it('signs the development user in as Admin of the fixed development Workspace', async () => {
    const response = await getSession()

    expect(response.statusCode).toBe(200)

    const session = sessionSchema.parse(response.json())

    expect(session).toMatchObject({
      operator: false,
      workspace: {
        id: '5f0c3a52-7d1e-4b8a-9c61-2e4f8d9a1b07',
        name: 'Nordwind Handel GmbH',
        kind: 'standard',
      },
      role: 'admin',
    })
  })

  it('opens the Workspace the resolver picks for the request', async () => {
    const response = await getSession(otherApp)

    expect(response.statusCode).toBe(200)
    expect(sessionSchema.parse(response.json()).workspace).toEqual({
      id: otherWorkspace.id,
      name: otherWorkspace.name,
      kind: 'standard',
    })
  })
})
