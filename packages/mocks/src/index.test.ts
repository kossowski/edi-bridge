import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import {
  channelsEndpoint,
  createChannelEndpoint,
  mappingVersionsEndpoint,
  type ReprocessRunBody,
  reprocessRunEndpoint,
  retryRunEndpoint,
  type RunListQuery,
  runDetailSchema,
  runEndpoint,
  runListSchema,
  runsEndpoint,
  toPath,
  toSearchParams,
} from '@edi-bridge/contracts'

import { createHandlers } from './index'

const apiUrl = 'http://api.test'

const server = setupServer()

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))

afterEach(() => server.resetHandlers())

afterAll(() => server.close())

async function listRuns(query: Partial<RunListQuery>) {
  const response = await fetch(`${apiUrl}${runsEndpoint.path}?${toSearchParams(query)}`)

  return runListSchema.parse(await response.json())
}

async function getRun(id: string) {
  const response = await fetch(`${apiUrl}${toPath(runEndpoint.path, { id })}`)

  return runDetailSchema.parse(await response.json())
}

async function post(path: string, body?: ReprocessRunBody) {
  const response = await fetch(`${apiUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? null : JSON.stringify(body),
  })

  return runDetailSchema.parse(await response.json())
}

describe('createHandlers', () => {
  it('lists a retried Run as delivered', async () => {
    server.use(...createHandlers(apiUrl))
    const { runs } = await listRuns({ status: ['failed'], failureStage: ['delivery'] })
    const failed = runs[0]!

    await post(toPath(retryRunEndpoint.path, { id: failed.id }))

    const { runs: listed } = await listRuns({
      flowId: [failed.flow.id],
      receivedFrom: failed.receivedAt,
      receivedTo: failed.receivedAt,
    })

    expect(listed.find(({ id }) => id === failed.id)).toMatchObject({
      status: 'delivered',
      failureStage: null,
    })
  })

  it('lists the Run that a Reprocess started', async () => {
    server.use(...createHandlers(apiUrl))
    const { runs } = await listRuns({ status: ['failed'], failureStage: ['mapping'] })
    const details = await Promise.all(runs.map(({ id }) => getRun(id)))
    const failed = details.find(({ replacedBy }) => replacedBy === null)!

    const versionsResponse = await fetch(
      `${apiUrl}${toPath(mappingVersionsEndpoint.path, { mappingId: failed.mappingVersion!.mappingId })}`,
    )

    const [latest] = mappingVersionsEndpoint.response.parse(await versionsResponse.json())

    const replacing = await post(toPath(reprocessRunEndpoint.path, { id: failed.id }), {
      mappingVersionId: latest!.id,
    })

    const { runs: listed } = await listRuns({ flowId: [failed.flow.id], pageSize: 1 })

    expect(listed[0]).toMatchObject({ id: replacing.id, status: 'delivered' })
  })

  it('keeps the changes of one createHandlers call out of another', async () => {
    server.use(...createHandlers(apiUrl))
    const { runs } = await listRuns({ status: ['failed'], failureStage: ['delivery'] })
    await post(toPath(retryRunEndpoint.path, { id: runs[0]!.id }))

    server.resetHandlers(...createHandlers(apiUrl))
    const { runs: fresh } = await listRuns({ status: ['failed'], failureStage: ['delivery'] })

    expect(fresh[0]?.id).toBe(runs[0]!.id)
  })

  it('keeps a created Channel within one createHandlers call', async () => {
    server.use(...createHandlers(apiUrl, { channels: [] }))

    await fetch(`${apiUrl}${createChannelEndpoint.path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'webhook',
        direction: 'inbound',
        name: 'Shop webhook',
        tradingPartnerId: null,
        rateLimitPerMinute: 60,
      }),
    })

    const listChannels = async () =>
      channelsEndpoint.response.parse(
        await (await fetch(`${apiUrl}${channelsEndpoint.path}`)).json(),
      )

    expect(await listChannels()).toHaveLength(1)

    server.resetHandlers(...createHandlers(apiUrl, { channels: [] }))

    expect(await listChannels()).toEqual([])
  })
})
