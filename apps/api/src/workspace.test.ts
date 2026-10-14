import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import type { FastifyInstance } from 'fastify'

import {
  type CompanyIdentityInput,
  currentWorkspaceEndpoint,
  updateCompanyIdentityEndpoint,
  withCheckDigit,
} from '@edi-bridge/contracts'
import { connect, type Connection, workspaces } from '@edi-bridge/db'
import { startTestDatabase, type TestDatabase } from '@edi-bridge/db/testing'

import { buildApp } from './app.js'
import { otherWorkspace } from './testing.js'
import { seedDevelopmentWorkspace } from './workspace.js'

const up = () => Promise.resolve()

const developmentWorkspace = {
  id: '5f0c3a52-7d1e-4b8a-9c61-2e4f8d9a1b07',
  name: 'Nordwind Handel GmbH',
  gln: withCheckDigit('021234500000'),
}

const otherGln = withCheckDigit('029876500000')

let testDatabase: TestDatabase

let connection: Connection

let app: FastifyInstance

beforeAll(async () => {
  testDatabase = await startTestDatabase()
  connection = connect(testDatabase.url)
  await seedDevelopmentWorkspace(connection.db)
  app = buildApp({ database: connection.db, probes: { postgres: up, redis: up } })
}, 60_000)

afterAll(async () => {
  await app.close()
  await connection.close()
  await testDatabase.stop()
})

const getCurrentWorkspace = (target = app) =>
  target.inject({ method: 'GET', url: currentWorkspaceEndpoint.path })

const updateIdentity = (body: Partial<CompanyIdentityInput>) =>
  app.inject({ method: 'PUT', url: updateCompanyIdentityEndpoint.path, body })

beforeEach(async () => {
  await updateIdentity({ gln: developmentWorkspace.gln })
})

describe('GET /workspaces/current', () => {
  it('returns the fixed development Workspace', async () => {
    const response = await getCurrentWorkspace()

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual(developmentWorkspace)
  })

  it('returns the Workspace the resolver picks for the request', async () => {
    await connection.db.insert(workspaces).values(otherWorkspace)

    const otherApp = buildApp({
      database: connection.db,
      probes: { postgres: up, redis: up },
      resolveWorkspace: () => otherWorkspace.id,
    })

    const response = await getCurrentWorkspace(otherApp)

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual(otherWorkspace)

    await otherApp.close()
  })
})

describe('PUT /workspaces/current/identity', () => {
  it('stores the GLN of the company identity', async () => {
    const response = await updateIdentity({ gln: otherGln })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ ...developmentWorkspace, gln: otherGln })

    const current = await getCurrentWorkspace()

    expect(current.json()).toEqual({ ...developmentWorkspace, gln: otherGln })
  })

  it.each([
    ['a wrong check digit', { gln: `${otherGln.slice(0, 12)}0` }],
    ['too few digits', { gln: '12345' }],
    ['no GLN', {}],
  ])('rejects a GLN with %s', async (_case, body) => {
    const response = await updateIdentity(body)

    expect(response.statusCode).toBe(400)
    expect(response.json()).toHaveProperty('message')

    const current = await getCurrentWorkspace()

    expect(current.json()).toEqual(developmentWorkspace)
  })
})

describe('seedDevelopmentWorkspace', () => {
  it('keeps a changed company identity when it seeds again', async () => {
    await updateIdentity({ gln: otherGln })

    await seedDevelopmentWorkspace(connection.db)

    const current = await getCurrentWorkspace()

    expect(current.json()).toEqual({ ...developmentWorkspace, gln: otherGln })
  })
})
