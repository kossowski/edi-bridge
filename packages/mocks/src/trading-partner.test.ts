import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import {
  channelsEndpoint,
  type CompanyIdentityInput,
  createTradingPartnerEndpoint,
  currentWorkspaceEndpoint,
  glnIssue,
  interchangeEndpoint,
  type TradingPartner,
  type TradingPartnerInput,
  toPath,
  switchToProductionEndpoint,
  tradingPartnerEndpoint,
  tradingPartnerSchema,
  tradingPartnersEndpoint,
  updateCompanyIdentityEndpoint,
  updateTradingPartnerEndpoint,
  workspaceSchema,
} from '@edi-bridge/contracts'

import { createHandlers } from './index'
import { seedRuns } from './run'
import { interchangeIdOf } from './run-detail'
import {
  createTradingPartner,
  createTradingPartners,
  hasTraffic,
  seedTradingPartners,
  tradingPartnerHandlers,
} from './trading-partner'
import { createWorkspace } from './workspace'

const apiUrl = 'http://api.test'

const server = setupServer()

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))

afterEach(() => server.resetHandlers())

afterAll(() => server.close())

async function send(
  method: string,
  path: string,
  body?: TradingPartnerInput | CompanyIdentityInput,
) {
  return fetch(`${apiUrl}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? null : JSON.stringify(body),
  })
}

async function listTradingPartners() {
  const response = await send('GET', tradingPartnersEndpoint.path)

  return tradingPartnersEndpoint.response.parse(await response.json())
}

const input: TradingPartnerInput = {
  name: 'Kieler Kontor GmbH',
  gln: '0234567890129',
  characterSet: 'UNOC',
  acknowledgementTimeLimitHours: 12,
}

const awaitingProduction = createTradingPartner({
  id: '10000000-0000-4000-8000-000000000001',
  gln: '0200000000011',
  testMode: true,
  onboarding: {
    testInterchangeSentAt: '2026-10-01T08:00:00.000Z',
    contrlReceivedAt: '2026-10-01T08:05:00.000Z',
  },
})

const awaitingContrl = createTradingPartner({
  id: '10000000-0000-4000-8000-000000000002',
  gln: '0200000000028',
  testMode: true,
  onboarding: { testInterchangeSentAt: '2026-10-01T08:00:00.000Z', contrlReceivedAt: null },
})

describe('seedTradingPartners', () => {
  it('uses unique GLNs from the restricted-circulation prefixes 020–029', () => {
    const glns = seedTradingPartners.map(({ gln }) => gln)

    expect(new Set(glns).size).toBe(glns.length)

    for (const gln of glns) {
      expect(gln).toMatch(/^02\d{11}$/)
      expect(glnIssue(gln)).toBeNull()
    }
  })

  it('covers production, a pending CONTRL and a Trading Partner without traffic', () => {
    expect(seedTradingPartners.some(({ testMode }) => !testMode)).toBe(true)

    expect(
      seedTradingPartners.some(
        (tradingPartner) =>
          tradingPartner.testMode &&
          hasTraffic(tradingPartner) &&
          !tradingPartner.onboarding.contrlReceivedAt,
      ),
    ).toBe(true)

    expect(seedTradingPartners.some((tradingPartner) => !hasTraffic(tradingPartner))).toBe(true)
  })

  it('carries the same GLN as the Interchanges exchanged with the Trading Partner', async () => {
    server.use(...createHandlers(apiUrl))
    const run = seedRuns().find(({ messageType }) => messageType === 'ORDERS')!

    const response = await send(
      'GET',
      toPath(interchangeEndpoint.path, { id: interchangeIdOf(run) }),
    )

    const interchange = interchangeEndpoint.response.parse(await response.json())
    const tradingPartner = seedTradingPartners.find(({ id }) => id === run.tradingPartner.id)!

    expect(interchange.sender.gln).toBe(tradingPartner.gln)
  })
})

describe('createTradingPartners', () => {
  it('generates a large volume of valid Trading Partners with unique GLNs', () => {
    const tradingPartners = createTradingPartners({ count: 500 })

    expect(tradingPartners).toHaveLength(500)
    expect(new Set(tradingPartners.map(({ gln }) => gln)).size).toBe(500)
    expect(new Set(tradingPartners.map(({ id }) => id)).size).toBe(500)

    for (const tradingPartner of tradingPartners) {
      expect(tradingPartnerSchema.parse(tradingPartner)).toEqual(tradingPartner)
    }
  })

  it('generates the same Trading Partners for the same seed', () => {
    const now = new Date('2026-10-09T12:00:00.000Z')

    expect(createTradingPartners({ count: 3, now, seed: 1 })).toEqual(
      createTradingPartners({ count: 3, now, seed: 1 }),
    )
  })
})

describe('tradingPartnerHandlers', () => {
  it('creates a Trading Partner in Test Mode and lists it', async () => {
    server.use(...tradingPartnerHandlers(apiUrl, { tradingPartners: [] }))

    const response = await send('POST', createTradingPartnerEndpoint.path, input)
    const created = tradingPartnerSchema.parse(await response.json())

    expect(response.status).toBe(201)

    expect(created).toMatchObject({
      ...input,
      testMode: true,
      onboarding: { testInterchangeSentAt: null, contrlReceivedAt: null },
    })

    expect(await listTradingPartners()).toEqual([created])
  })

  it('updates the editable fields and keeps the onboarding state', async () => {
    server.use(...tradingPartnerHandlers(apiUrl, { tradingPartners: [awaitingContrl] }))
    const path = toPath(updateTradingPartnerEndpoint.path, { id: awaitingContrl.id })

    await send('PUT', path, input)
    const response = await send('GET', toPath(tradingPartnerEndpoint.path, awaitingContrl))

    expect(tradingPartnerSchema.parse(await response.json())).toEqual({
      ...awaitingContrl,
      ...input,
    })
  })

  it('lets a Trading Partner keep its own GLN on update', async () => {
    server.use(...tradingPartnerHandlers(apiUrl, { tradingPartners: [awaitingContrl] }))
    const path = toPath(updateTradingPartnerEndpoint.path, { id: awaitingContrl.id })

    const response = await send('PUT', path, { ...input, gln: awaitingContrl.gln })

    expect(response.status).toBe(200)
  })

  it.each([
    ['create', 'POST', createTradingPartnerEndpoint.path],
    ['update', 'PUT', toPath(updateTradingPartnerEndpoint.path, { id: awaitingProduction.id })],
  ])('rejects a GLN that another Trading Partner uses on %s', async (_, method, path) => {
    server.use(
      ...tradingPartnerHandlers(apiUrl, { tradingPartners: [awaitingProduction, awaitingContrl] }),
    )

    const response = await send(method, path, { ...input, gln: awaitingContrl.gln })

    expect(response.status).toBe(409)
  })

  it('rejects a GLN with a wrong check digit', async () => {
    server.use(...tradingPartnerHandlers(apiUrl, { tradingPartners: [] }))

    const response = await send('POST', createTradingPartnerEndpoint.path, {
      ...input,
      gln: '0234567890128',
    })

    expect(response.status).toBe(400)
  })

  it('answers 404 for an unknown Trading Partner', async () => {
    server.use(...tradingPartnerHandlers(apiUrl, { tradingPartners: [] }))

    const response = await send('GET', toPath(tradingPartnerEndpoint.path, awaitingContrl))

    expect(response.status).toBe(404)
  })

  it('switches a Trading Partner to production once its CONTRL is received', async () => {
    server.use(...tradingPartnerHandlers(apiUrl, { tradingPartners: [awaitingProduction] }))

    const response = await send('POST', toPath(switchToProductionEndpoint.path, awaitingProduction))

    expect(tradingPartnerSchema.parse(await response.json()).testMode).toBe(false)
    expect((await listTradingPartners())[0]?.testMode).toBe(false)
  })

  it.each<[string, TradingPartner, string | null]>([
    ['before the CONTRL is received', awaitingContrl, '0212345000007'],
    ['while the Workspace has no GLN', awaitingProduction, null],
  ])('refuses the production switch %s', async (_, tradingPartner, gln) => {
    server.use(
      ...tradingPartnerHandlers(apiUrl, {
        tradingPartners: [tradingPartner],
        workspace: createWorkspace({ gln }),
      }),
    )

    const response = await send('POST', toPath(switchToProductionEndpoint.path, tradingPartner))

    expect(response.status).toBe(409)
  })
})

describe('createHandlers', () => {
  it('records the company GLN and enables the production switch with it', async () => {
    server.use(
      ...createHandlers(apiUrl, {
        workspace: createWorkspace({ gln: null }),
        tradingPartners: [awaitingProduction],
      }),
    )

    const path = toPath(switchToProductionEndpoint.path, awaitingProduction)
    expect((await send('POST', path)).status).toBe(409)

    await send('PUT', updateCompanyIdentityEndpoint.path, { gln: '0212345000007' })
    const workspace = await send('GET', currentWorkspaceEndpoint.path)

    expect(workspaceSchema.parse(await workspace.json()).gln).toBe('0212345000007')
    expect((await send('POST', path)).status).toBe(200)
  })

  it('rejects a company GLN with a wrong check digit', async () => {
    server.use(...createHandlers(apiUrl))

    const response = await send('PUT', updateCompanyIdentityEndpoint.path, {
      gln: '0212345000008',
    })

    expect(response.status).toBe(400)
  })

  it('serves the Channels of each Trading Partner with traffic', async () => {
    server.use(...createHandlers(apiUrl))
    const response = await send('GET', channelsEndpoint.path)
    const channels = channelsEndpoint.response.parse(await response.json())

    for (const { id } of seedTradingPartners.filter(hasTraffic)) {
      expect(channels.filter(({ tradingPartnerId }) => tradingPartnerId === id)).not.toHaveLength(0)
    }
  })
})
