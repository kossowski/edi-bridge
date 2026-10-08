import {
  currentWorkspaceEndpoint,
  type Endpoint,
  flowsEndpoint,
  type QueryParams,
  type RunListQuery,
  runsEndpoint,
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

async function request<Response, Query extends QueryParams | undefined = undefined>(
  endpoint: Endpoint<Response, Query>,
  query?: Query,
): Promise<Response> {
  if (isMockingEnabled && typeof window !== 'undefined') {
    mockingStarted ??= import('./mock-worker').then(({ startMockWorker }) => startMockWorker())
    await mockingStarted
  }

  const search = endpoint.query ? `?${toSearchParams(endpoint.query.parse(query))}` : ''
  const response = await fetch(`${apiUrl}${endpoint.path}${search}`, { method: endpoint.method })

  if (!response.ok) {
    throw new ApiError(response.status, endpoint.path)
  }

  return endpoint.response.parse(await response.json())
}

export function getCurrentWorkspace() {
  return request(currentWorkspaceEndpoint)
}

export function listRuns(query: RunListQuery) {
  return request(runsEndpoint, query)
}

export function listTradingPartners() {
  return request(tradingPartnersEndpoint)
}

export function listFlows() {
  return request(flowsEndpoint)
}
