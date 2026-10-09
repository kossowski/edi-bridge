import {
  channelEndpoint,
  type ChannelInput,
  channelsEndpoint,
  type ChannelUpdate,
  type CompanyIdentityInput,
  createChannelEndpoint,
  createFlowEndpoint,
  createTradingPartnerEndpoint,
  currentWorkspaceEndpoint,
  type Endpoint,
  flowEndpoint,
  type FlowInput,
  flowsEndpoint,
  type FlowUpdate,
  interchangeEndpoint,
  mappingVersionsEndpoint,
  type MoveFlowMappingVersionBody,
  moveFlowMappingVersionEndpoint,
  publishedMappingVersionsEndpoint,
  type PublishedMappingVersionsQuery,
  type QueryParams,
  regenerateWebhookTokenEndpoint,
  type ReprocessRunBody,
  reprocessRunEndpoint,
  retryRunEndpoint,
  runEndpoint,
  type RunListQuery,
  runsEndpoint,
  switchToProductionEndpoint,
  toPath,
  toSearchParams,
  tradingPartnerEndpoint,
  type TradingPartnerInput,
  tradingPartnersEndpoint,
  updateChannelEndpoint,
  updateCompanyIdentityEndpoint,
  updateFlowEndpoint,
  updateTradingPartnerEndpoint,
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

export function updateCompanyIdentity(body: CompanyIdentityInput) {
  return request(updateCompanyIdentityEndpoint, { body })
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

export function listPublishedMappingVersions(query: PublishedMappingVersionsQuery) {
  return request(publishedMappingVersionsEndpoint, { query })
}

export function listTradingPartners() {
  return request(tradingPartnersEndpoint)
}

export function getTradingPartner(id: string) {
  return request(tradingPartnerEndpoint, { path: toPath(tradingPartnerEndpoint.path, { id }) })
}

export function createTradingPartner(body: TradingPartnerInput) {
  return request(createTradingPartnerEndpoint, { body })
}

export function updateTradingPartner(id: string, body: TradingPartnerInput) {
  return request(updateTradingPartnerEndpoint, {
    path: toPath(updateTradingPartnerEndpoint.path, { id }),
    body,
  })
}

export function switchToProduction(id: string) {
  return request(switchToProductionEndpoint, {
    path: toPath(switchToProductionEndpoint.path, { id }),
  })
}

export function listChannels() {
  return request(channelsEndpoint)
}

export function getChannel(id: string) {
  return request(channelEndpoint, { path: toPath(channelEndpoint.path, { id }) })
}

export function createChannel(body: ChannelInput) {
  return request(createChannelEndpoint, { body })
}

export function updateChannel(id: string, body: ChannelUpdate) {
  return request(updateChannelEndpoint, { path: toPath(updateChannelEndpoint.path, { id }), body })
}

export function regenerateWebhookToken(id: string) {
  return request(regenerateWebhookTokenEndpoint, {
    path: toPath(regenerateWebhookTokenEndpoint.path, { id }),
  })
}

export function listFlows() {
  return request(flowsEndpoint)
}

export function getFlow(id: string) {
  return request(flowEndpoint, { path: toPath(flowEndpoint.path, { id }) })
}

export function createFlow(body: FlowInput) {
  return request(createFlowEndpoint, { body })
}

export function updateFlow(id: string, body: FlowUpdate) {
  return request(updateFlowEndpoint, { path: toPath(updateFlowEndpoint.path, { id }), body })
}

export function moveFlowMappingVersion(id: string, body: MoveFlowMappingVersionBody) {
  return request(moveFlowMappingVersionEndpoint, {
    path: toPath(moveFlowMappingVersionEndpoint.path, { id }),
    body,
  })
}
