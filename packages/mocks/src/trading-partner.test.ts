import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

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
  sendTestInterchangeEndpoint,
  switchToProductionEndpoint,
  testInterchangeRefusedProblemSchema,
  tradingPartnerActivitiesEndpoint,
  tradingPartnerEndpoint,
  tradingPartnerSchema,
  tradingPartnersEndpoint,
  updateCompanyIdentityEndpoint,
  updateTradingPartnerEndpoint,
  workspaceSchema,
} from '@edi-bridge/contracts'

import { createHandlers } from './index'
import { seedRuns } from './run'
import { interchangeIdOf } from './run-store'
import { sandboxAdminSession, showcaseViewerSession } from './session'
import { seedRunsBeforeAll } from './test-helpers'
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

seedRunsBeforeAll()

afterEach(() => {
  server.resetHandlers()
  vi.useRealTimers()
})

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
    testRejectedAt: null,
    testRejectedRunId: null,
  },
})

const awaitingContrl = createTradingPartner({
  id: '10000000-0000-4000-8000-000000000002',
  gln: '0200000000028',
  testMode: true,
  onboarding: {
    testInterchangeSentAt: '2026-10-01T08:00:00.000Z',
    contrlReceivedAt: null,
    testRejectedAt: null,
    testRejectedRunId: null,
  },
})

describe('seedTradingPartners', () => {
  it('uses unique GLNs from the restricted-circulation prefixes 020–029', () => {
    const glns = seedTradingPartners.flatMap(({ gln }) => (gln === null ? [] : [gln]))

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

  it('covers a Trading Partner whose GLN is added later', () => {
    expect(seedTradingPartners.some(({ gln }) => gln === null)).toBe(true)
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
    const glns = tradingPartners.flatMap(({ gln }) => (gln === null ? [] : [gln]))
    expect(new Set(glns).size).toBe(glns.length)
    expect(new Set(tradingPartners.map(({ id }) => id)).size).toBe(500)

    for (const tradingPartner of tradingPartners) {
      expect(tradingPartnerSchema.parse(tradingPartner)).toEqual(tradingPartner)
    }
  })

  it('leaves the GLN for later only before the first test Interchange', () => {
    const withoutGln = createTradingPartners({ count: 500 }).filter(({ gln }) => gln === null)

    expect(withoutGln.length).toBeGreaterThan(0)

    for (const { onboarding } of withoutGln) {
      expect(onboarding.testInterchangeSentAt).toBeNull()
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
      onboarding: {
        testInterchangeSentAt: null,
        contrlReceivedAt: null,
        testRejectedAt: null,
        testRejectedRunId: null,
      },
    })

    expect(await listTradingPartners()).toEqual([created])
  })

  it('creates several Trading Partners whose GLN is added later', async () => {
    server.use(...tradingPartnerHandlers(apiUrl, { tradingPartners: [] }))

    const first = await send('POST', createTradingPartnerEndpoint.path, { ...input, gln: null })
    const second = await send('POST', createTradingPartnerEndpoint.path, { ...input, gln: null })

    expect([first.status, second.status]).toEqual([201, 201])
    expect((await listTradingPartners()).map(({ gln }) => gln)).toEqual([null, null])
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
    ['once a test Interchange was sent', awaitingContrl],
    ['in production', { ...awaitingProduction, testMode: false }],
  ])('refuses to clear the GLN of a Trading Partner %s', async (_, tradingPartner) => {
    server.use(...tradingPartnerHandlers(apiUrl, { tradingPartners: [tradingPartner] }))
    const path = toPath(updateTradingPartnerEndpoint.path, { id: tradingPartner.id })

    const response = await send('PUT', path, { ...input, gln: null })
    const stored = await send('GET', toPath(tradingPartnerEndpoint.path, tradingPartner))

    expect(response.status).toBe(422)
    expect(tradingPartnerSchema.parse(await stored.json()).gln).toBe(tradingPartner.gln)
  })

  it('lets a Trading Partner without traffic clear its GLN', async () => {
    const notStarted = createTradingPartner({
      gln: '0200000000035',
      testMode: true,
      onboarding: {
        testInterchangeSentAt: null,
        contrlReceivedAt: null,
        testRejectedAt: null,
        testRejectedRunId: null,
      },
    })

    server.use(...tradingPartnerHandlers(apiUrl, { tradingPartners: [notStarted] }))
    const path = toPath(updateTradingPartnerEndpoint.path, { id: notStarted.id })

    const response = await send('PUT', path, { ...input, gln: null })

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

describe('POST /trading-partners/:id/test-interchange', () => {
  const notStarted = createTradingPartner({
    id: '10000000-0000-4000-8000-000000000003',
    gln: '0200000000035',
    testMode: true,
    onboarding: {
      testInterchangeSentAt: null,
      contrlReceivedAt: null,
      testRejectedAt: null,
      testRejectedRunId: null,
    },
  })

  const sentAt = new Date('2026-10-10T12:00:00.000Z')

  async function getTradingPartner(id: string) {
    const response = await send('GET', toPath(tradingPartnerEndpoint.path, { id }))

    return tradingPartnerSchema.parse(await response.json())
  }

  it('records the test Interchange and receives its CONTRL after the delay', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(sentAt)

    server.use(
      ...tradingPartnerHandlers(apiUrl, {
        tradingPartners: [notStarted],
        testInterchange: { contrlDelayMs: 60_000 },
      }),
    )

    const response = await send('POST', toPath(sendTestInterchangeEndpoint.path, notStarted))

    expect(tradingPartnerSchema.parse(await response.json()).onboarding).toEqual({
      testInterchangeSentAt: '2026-10-10T12:00:00.000Z',
      contrlReceivedAt: null,
      testRejectedAt: null,
      testRejectedRunId: null,
    })

    vi.setSystemTime(new Date('2026-10-10T12:00:59.000Z'))
    expect((await getTradingPartner(notStarted.id)).onboarding.contrlReceivedAt).toBeNull()

    vi.setSystemTime(new Date('2026-10-10T12:01:30.000Z'))

    expect((await listTradingPartners())[0]?.onboarding).toEqual({
      testInterchangeSentAt: '2026-10-10T12:00:00.000Z',
      contrlReceivedAt: '2026-10-10T12:01:00.000Z',
      testRejectedAt: null,
      testRejectedRunId: null,
    })
  })

  it('records a rejecting CONTRL after the delay, with the Run of the rejected test', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(sentAt)
    const rejectingRunId = '10000000-0000-4000-8000-0000000000e1'

    server.use(
      ...tradingPartnerHandlers(apiUrl, {
        tradingPartners: [notStarted],
        testInterchange: { contrlDelayMs: 60_000, rejectingRunId },
      }),
    )

    await send('POST', toPath(sendTestInterchangeEndpoint.path, notStarted))
    vi.setSystemTime(new Date('2026-10-10T12:01:30.000Z'))

    expect((await getTradingPartner(notStarted.id)).onboarding).toEqual({
      testInterchangeSentAt: '2026-10-10T12:00:00.000Z',
      contrlReceivedAt: null,
      testRejectedAt: '2026-10-10T12:01:00.000Z',
      testRejectedRunId: rejectingRunId,
    })
  })

  it('clears the rejected test with the next test send', async () => {
    const rejected = {
      ...notStarted,
      onboarding: {
        testInterchangeSentAt: '2026-10-09T08:00:00.000Z',
        contrlReceivedAt: null,
        testRejectedAt: '2026-10-09T08:05:00.000Z',
        testRejectedRunId: '10000000-0000-4000-8000-0000000000e1',
      },
    }

    server.use(
      ...tradingPartnerHandlers(apiUrl, {
        tradingPartners: [rejected],
        testInterchange: { contrlDelayMs: null },
      }),
    )

    const response = await send('POST', toPath(sendTestInterchangeEndpoint.path, rejected))

    expect(tradingPartnerSchema.parse(await response.json()).onboarding).toMatchObject({
      testRejectedAt: null,
      testRejectedRunId: null,
    })
  })

  it('lets the production switch follow once the CONTRL is received', async () => {
    server.use(
      ...tradingPartnerHandlers(apiUrl, {
        tradingPartners: [notStarted],
        testInterchange: { contrlDelayMs: 0 },
      }),
    )

    await send('POST', toPath(sendTestInterchangeEndpoint.path, notStarted))
    const response = await send('POST', toPath(switchToProductionEndpoint.path, notStarted))

    expect(response.status).toBe(200)
  })

  it('keeps waiting when the Trading Partner never confirms', async () => {
    server.use(
      ...tradingPartnerHandlers(apiUrl, {
        tradingPartners: [notStarted],
        testInterchange: { contrlDelayMs: null },
      }),
    )

    await send('POST', toPath(sendTestInterchangeEndpoint.path, notStarted))

    expect((await getTradingPartner(notStarted.id)).onboarding.contrlReceivedAt).toBeNull()
  })

  it.each<[string, TradingPartner, string | null]>([
    ['in production', { ...awaitingProduction, testMode: false }, '0212345000007'],
    ['whose CONTRL is already received', awaitingProduction, '0212345000007'],
    ['while the Workspace has no GLN', notStarted, null],
    ['without its own GLN', { ...notStarted, gln: null }, '0212345000007'],
  ])('refuses a Trading Partner %s', async (_, tradingPartner, gln) => {
    server.use(
      ...tradingPartnerHandlers(apiUrl, {
        tradingPartners: [tradingPartner],
        workspace: createWorkspace({ gln }),
      }),
    )

    const response = await send('POST', toPath(sendTestInterchangeEndpoint.path, tradingPartner))

    expect(response.status).toBe(409)
    expect(testInterchangeRefusedProblemSchema.parse(await response.json())).toMatchObject({
      reason: 'notAwaited',
    })
    expect(await getTradingPartner(tradingPartner.id)).toEqual(tradingPartner)
  })

  it.each([
    { reason: 'noOutboundFlow' as const },
    {
      reason: 'sampleMissing' as const,
      flow: { id: '10000000-0000-4000-8000-0000000000f1', name: 'Invoices to Kieler Kontor' },
    },
  ])('refuses the test send for the simulated reason $reason', async (refusal) => {
    server.use(
      ...tradingPartnerHandlers(apiUrl, {
        tradingPartners: [notStarted],
        testInterchange: { refusal },
      }),
    )

    const response = await send('POST', toPath(sendTestInterchangeEndpoint.path, notStarted))

    expect(response.status).toBe(409)
    expect(testInterchangeRefusedProblemSchema.parse(await response.json())).toMatchObject(refusal)
    expect(await getTradingPartner(notStarted.id)).toEqual(notStarted)
  })

  it('answers 404 for an unknown Trading Partner', async () => {
    server.use(...tradingPartnerHandlers(apiUrl, { tradingPartners: [] }))

    const response = await send('POST', toPath(sendTestInterchangeEndpoint.path, notStarted))

    expect(response.status).toBe(404)
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

  it('answers 404 for a Trading Partner id that is not a UUID, like the api', async () => {
    server.use(...createHandlers(apiUrl))

    const missing = await send('GET', toPath(tradingPartnerEndpoint.path, { id: 'no-such-id' }))
    const activities = await send('GET', tradingPartnerActivitiesEndpoint.path)

    expect(missing.status).toBe(404)
    expect(activities.status).toBe(200)
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

describe('tradingPartnerHandlers for a Viewer', () => {
  const path = (endpoint: { path: string }) => toPath(endpoint.path, awaitingProduction)

  it.each([
    ['create a Trading Partner', () => send('POST', createTradingPartnerEndpoint.path, input)],
    ['update a Trading Partner', () => send('PUT', path(updateTradingPartnerEndpoint), input)],
    ['switch to production', () => send('POST', path(switchToProductionEndpoint))],
    ['send a test Interchange', () => send('POST', path(sendTestInterchangeEndpoint))],
  ])('answers 403 to %s and changes nothing', async (_, request) => {
    server.use(
      ...tradingPartnerHandlers(apiUrl, {
        tradingPartners: [awaitingProduction],
        session: showcaseViewerSession,
      }),
    )

    expect((await request()).status).toBe(403)
    expect(await listTradingPartners()).toEqual([awaitingProduction])
  })

  it('lets an Admin create a Trading Partner', async () => {
    server.use(
      ...tradingPartnerHandlers(apiUrl, { tradingPartners: [], session: sandboxAdminSession }),
    )

    expect((await send('POST', createTradingPartnerEndpoint.path, input)).status).toBe(201)
  })
})
