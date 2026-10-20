import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { firstStepsEndpoint, firstStepsSchema } from '@edi-bridge/contracts'
import { tradingPartners } from '@edi-bridge/db'

import { seedWorkspaceWithAdmin, startTestApi, type TestApi } from './testing.js'

let api: TestApi

beforeAll(async () => {
  api = await startTestApi()
}, 60_000)

afterAll(async () => {
  await api.stop()
})

const firstSteps = async (as = api.admin) => {
  const response = await as.inject({
    method: firstStepsEndpoint.method,
    url: firstStepsEndpoint.path,
  })

  expect(response.statusCode).toBe(200)

  return firstStepsSchema.parse(response.json())
}

describe('GET /workspaces/current/first-steps', () => {
  it('leaves every step open in a fresh Workspace', async () => {
    expect(await firstSteps()).toEqual({
      steps: [
        { id: 'gln', done: false, target: { kind: 'companySettings' } },
        { id: 'erpConnection', done: false, target: { kind: 'newChannel' } },
        { id: 'tradingPartner', done: false, target: { kind: 'newTradingPartner' } },
        { id: 'mapping', done: false, target: { kind: 'mappings' } },
        { id: 'testInterchange', done: false, target: { kind: 'newTradingPartner' } },
        { id: 'production', done: false, target: { kind: 'newTradingPartner' } },
      ],
    })
  })

  it('marks the steps done from the Workspace data and targets the partner to onboard next', async () => {
    const db = api.connection.db
    const { workspace, admin } = await seedWorkspaceWithAdmin(api, 'Nordwind Foods')

    const inTestMode = (name: string, testInterchangeSentAt: Date | null) => ({
      workspaceId: workspace.id,
      name,
      characterSet: 'UNOC' as const,
      acknowledgementTimeLimitHours: 24,
      testInterchangeSentAt,
    })

    const [tested, untested] = await db
      .insert(tradingPartners)
      .values([
        inTestMode('Alster Markt GmbH', new Date('2026-10-01T08:00:00.000Z')),
        inTestMode('Zeller Handel KG', null),
      ])
      .returning({ id: tradingPartners.id })

    expect(await firstSteps(admin)).toEqual({
      steps: [
        { id: 'gln', done: true, target: { kind: 'companySettings' } },
        { id: 'erpConnection', done: true, target: { kind: 'newChannel' } },
        { id: 'tradingPartner', done: true, target: { kind: 'newTradingPartner' } },
        { id: 'mapping', done: true, target: { kind: 'mappings' } },
        {
          id: 'testInterchange',
          done: true,
          target: { kind: 'tradingPartner', tradingPartnerId: untested?.id },
        },
        {
          id: 'production',
          done: true,
          target: { kind: 'tradingPartner', tradingPartnerId: tested?.id },
        },
      ],
    })
  })

  it('answers 401 without a session', async () => {
    const response = await api.app.inject({
      method: firstStepsEndpoint.method,
      url: firstStepsEndpoint.path,
    })

    expect(response.statusCode).toBe(401)
  })
})
