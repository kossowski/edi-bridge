import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import {
  type ChannelInput,
  type CompanyIdentityInput,
  createChannelEndpoint,
  createTradingPartnerEndpoint,
  firstStepsEndpoint,
  firstStepsProgress,
  firstStepsSchema,
  type SaveMappingDraftBody,
  saveMappingDraftEndpoint,
  sendTestInterchangeEndpoint,
  switchToProductionEndpoint,
  toPath,
  tradingPartnerEndpoint,
  type TradingPartnerInput,
  tradingPartnerSchema,
  updateCompanyIdentityEndpoint,
  withCheckDigit,
} from '@edi-bridge/contracts'

import { firstStepsHandler } from './first-steps'
import { createHandlers } from './index'
import { seedMappingDrafts } from './mapping'
import { publishDraft } from './publish-request'
import { seedRunsBeforeAll } from './test-helpers'
import { createWorkspace } from './workspace'

const apiUrl = 'http://api.test'

const server = setupServer()

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))

seedRunsBeforeAll()

afterEach(() => server.resetHandlers())

afterAll(() => server.close())

async function getFirstSteps() {
  const response = await fetch(`${apiUrl}${firstStepsEndpoint.path}`)

  return firstStepsSchema.parse(await response.json())
}

async function progress() {
  return firstStepsProgress(await getFirstSteps())
}

type Body = CompanyIdentityInput | ChannelInput | TradingPartnerInput | SaveMappingDraftBody

function send(method: 'POST' | 'PUT', path: string, body?: Body) {
  return fetch(`${apiUrl}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? null : JSON.stringify(body),
  })
}

describe('GET /workspaces/current/first-steps', () => {
  it('finds every step done in the seeded Workspace', async () => {
    server.use(firstStepsHandler(apiUrl))

    expect(await progress()).toEqual({
      done: 6,
      total: 6,
      next: undefined,
      hasTradingPartner: true,
    })
  })

  it('leaves every step open in a fresh Workspace', async () => {
    server.use(firstStepsHandler(apiUrl, 'fresh'))

    expect(await progress()).toEqual({ done: 0, total: 6, next: 'gln', hasTradingPartner: false })
  })

  it('stops at the first Mapping in a partly set-up Workspace', async () => {
    server.use(firstStepsHandler(apiUrl, 'partlyDone'))

    const steps = await getFirstSteps()

    expect(firstStepsProgress(steps)).toEqual({
      done: 3,
      total: 6,
      next: 'mapping',
      hasTradingPartner: true,
    })
    expect(steps.steps[4].target.kind).toBe('tradingPartner')
  })

  it('fails on request', async () => {
    server.use(firstStepsHandler(apiUrl, 'error'))

    expect((await fetch(`${apiUrl}${firstStepsEndpoint.path}`)).status).toBe(500)
  })

  it('answers only a signed-in user', async () => {
    server.use(firstStepsHandler(apiUrl, 'fresh', null))

    expect((await fetch(`${apiUrl}${firstStepsEndpoint.path}`)).status).toBe(401)
  })

  it('completes each step once the user actually does it', async () => {
    server.use(
      ...createHandlers(apiUrl, {
        workspace: createWorkspace({ gln: null }),
        channels: [],
        tradingPartners: [],
        mappingVersions: [],
        testInterchange: { handoverDelayMs: 0, contrlDelayMs: 0 },
      }),
    )

    expect(await progress()).toMatchObject({ done: 0, next: 'gln' })

    await send('PUT', updateCompanyIdentityEndpoint.path, { gln: withCheckDigit('400000000001') })
    expect(await progress()).toMatchObject({ done: 1, next: 'erpConnection' })

    await send('POST', createChannelEndpoint.path, {
      type: 'webhook',
      direction: 'inbound',
      name: 'ERP webhook',
      tradingPartnerId: null,
      rateLimitPerMinute: 60,
    })
    expect(await progress()).toMatchObject({ done: 2, next: 'tradingPartner' })

    const tradingPartner = tradingPartnerSchema.parse(
      await (
        await send('POST', createTradingPartnerEndpoint.path, {
          name: 'Hansemarkt GmbH',
          gln: withCheckDigit('400000000002'),
          characterSet: 'UNOC',
          acknowledgementTimeLimitHours: 24,
        })
      ).json(),
    )

    expect(await progress()).toMatchObject({ done: 3, next: 'mapping', hasTradingPartner: true })

    const mappingId = seedMappingDrafts[0]!.id

    await send('PUT', toPath(saveMappingDraftEndpoint.path, { id: mappingId }), {
      links: [],
      transforms: [],
      transformLinks: [],
    })
    await publishDraft(apiUrl, mappingId)
    expect(await progress()).toMatchObject({ done: 4, next: 'testInterchange' })

    const { id } = tradingPartner

    await send('POST', toPath(sendTestInterchangeEndpoint.path, { id }))
    // The worker hands the test Interchange over after the api answered the send.
    await fetch(`${apiUrl}${toPath(tradingPartnerEndpoint.path, { id })}`)
    expect(await progress()).toMatchObject({ done: 5, next: 'production' })

    await send('POST', toPath(switchToProductionEndpoint.path, { id }))
    expect(await progress()).toEqual({
      done: 6,
      total: 6,
      next: undefined,
      hasTradingPartner: true,
    })
  })
})
