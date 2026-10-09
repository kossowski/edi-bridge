import {
  currentWorkspaceEndpoint,
  type Endpoint,
  flowsEndpoint,
  interchangeEndpoint,
  mappingVersionsEndpoint,
  type QueryParams,
  type ReprocessRunBody,
  reprocessRunEndpoint,
  retryRunEndpoint,
  runEndpoint,
  type RunListQuery,
  runsEndpoint,
  toPath,
  toSearchParams,
  tradingPartnersEndpoint,
} from '@edi-bridge/contracts'

import { apiUrl, isMockingEnabled } from './config'

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
  ) {
    super(`API request to ${path} failed with status ${status}`)
    this.name = 'ApiError'
  }
}

let mockingStarted: Promise<unknown> | undefined

type RequestOptions<Query, Body> = {
  path?: string
  query?: Query
  body?: Body
}

async function request<
  Response,
  Query extends QueryParams | undefined = undefined,
  Body = undefined,
>(
  endpoint: Endpoint<Response, Query, Body>,
  { path = endpoint.path, query, body }: RequestOptions<Query, Body> = {},
): Promise<Response> {
  if (isMockingEnabled && typeof window !== 'undefined') {
    mockingStarted ??= import('./mock-worker').then(({ startMockWorker }) => startMockWorker())
    await mockingStarted
  }

  const search = query ? `?${toSearchParams(query)}` : ''

  const response = await fetch(`${apiUrl}${path}${search}`, {
    method: endpoint.method,
    ...(endpoint.body && {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(endpoint.body.parse(body)),
    }),
  })

  if (!response.ok) {
    throw new ApiError(response.status, path)
  }

  return endpoint.response.parse(await response.json())
}

export function getCurrentWorkspace() {
  return request(currentWorkspaceEndpoint)
}

export function listRuns(query: RunListQuery) {
  return request(runsEndpoint, { query })
}

export function getRun(id: string) {
  return request(runEndpoint, { path: toPath(runEndpoint.path, { id }) })
}

export function retryRun(id: string) {
  return request(retryRunEndpoint, { path: toPath(retryRunEndpoint.path, { id }) })
}

export function reprocessRun(id: string, body: ReprocessRunBody) {
  return request(reprocessRunEndpoint, { path: toPath(reprocessRunEndpoint.path, { id }), body })
}

export function getInterchange(id: string) {
  return request(interchangeEndpoint, { path: toPath(interchangeEndpoint.path, { id }) })
}

export function listMappingVersions(mappingId: string) {
  return request(mappingVersionsEndpoint, {
    path: toPath(mappingVersionsEndpoint.path, { mappingId }),
  })
}

export function listTradingPartners() {
  return request(tradingPartnersEndpoint)
}

export function listFlows() {
  return request(flowsEndpoint)
}
