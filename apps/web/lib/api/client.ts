import {
  acceptAiDraftEndpoint,
  aiBudgetEndpoint,
  type AiBudgetExhaustedProblem,
  aiBudgetExhaustedProblemSchema,
  aiBudgetExhaustedStatus,
  type AiDraftEvent,
  aiReviewOpenStatus,
  channelEndpoint,
  type ChannelInput,
  channelsEndpoint,
  type ChannelUpdate,
  type CompanyIdentityInput,
  createChannelEndpoint,
  type CreateDocumentStructureBody,
  createDocumentStructureEndpoint,
  createFlowEndpoint,
  createInviteEndpoint,
  createLookupTableEndpoint,
  type CreateMappingBody,
  createMappingEndpoint,
  createTradingPartnerEndpoint,
  createWorkspaceEndpoint,
  currentWorkspaceEndpoint,
  deleteLookupTableEndpoint,
  documentStructureEndpoint,
  type DocumentStructureOrigin,
  type DocumentStructureProblem,
  documentStructureProblemSchema,
  documentStructuresEndpoint,
  type Endpoint,
  flowEndpoint,
  type FlowInput,
  flowsEndpoint,
  inferDocumentStructureEndpoint,
  type InviteInput,
  type FlowUpdate,
  importLookupTableEndpoint,
  type InterchangeListQuery,
  interchangesEndpoint,
  liveEventsEndpoint,
  lookupTableEndpoint,
  type LookupTableImportBody,
  lookupTableImportPreviewEndpoint,
  type LookupTableInput,
  lookupTablesEndpoint,
  type ManualSubmissionInput,
  mappingDraftEndpoint,
  mappingPreviewEndpoint,
  mappingSamplesEndpoint,
  mappingsEndpoint,
  mappingComparisonEndpoint,
  type MappingComparisonQuery,
  mappingVersionEndpoint,
  mappingVersionsEndpoint,
  type MessageType,
  messageTypeStructureEndpoint,
  type MoveFlowMappingVersionBody,
  operatorWorkspaceMembersEndpoint,
  operatorWorkspaceSettingsEndpoint,
  parseAiDraftEvent,
  operatorWorkspacesEndpoint,
  moveFlowMappingVersionEndpoint,
  type OrderLifecycleQuery,
  orderLifecyclesEndpoint,
  overviewEndpoint,
  type OverviewQuery,
  publishedMappingVersionsEndpoint,
  publishMappingDraftEndpoint,
  type PreviewMappingBody,
  type PublishedMappingVersionsQuery,
  type QueryParams,
  regenerateWebhookTokenEndpoint,
  type ReprocessRunBody,
  type RequestAiDraftBody,
  requestAiDraftEndpoint,
  reprocessRunEndpoint,
  resetSandboxWorkspaceEndpoint,
  revokeInviteEndpoint,
  retryRunEndpoint,
  type SaveMappingDraftBody,
  sessionEndpoint,
  showcaseSignInEndpoint,
  type SignInBody,
  signInEndpoint,
  signOutEndpoint,
  saveMappingDraftEndpoint,
  runEndpoint,
  type RunListQuery,
  runsEndpoint,
  submitDocumentEndpoint,
  sendTestInterchangeEndpoint,
  switchToProductionEndpoint,
  toPath,
  toSearchParams,
  tradingPartnerActivitiesEndpoint,
  tradingPartnerActivityEndpoint,
  tradingPartnerEndpoint,
  type TradingPartnerInput,
  tradingPartnersEndpoint,
  testChannelEndpoint,
  updateChannelEndpoint,
  updateCompanyIdentityEndpoint,
  type UpdateDocumentStructureBody,
  updateDocumentStructureEndpoint,
  updateFlowEndpoint,
  updateLookupTableEndpoint,
  updateOperatorWorkspaceSettingsEndpoint,
  updateTradingPartnerEndpoint,
  waitForTradingPartnerRunEndpoint,
  workspaceSettingsEndpoint,
  type WorkspaceInput,
  workspaceInvitesEndpoint,
  workspaceMembersEndpoint,
  type WorkspaceSettingsInput,
} from '@edi-bridge/contracts'

import { apiUrl, isMockingEnabled } from './config'
import { eventStreamData } from './event-stream'

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    readonly body = '',
  ) {
    super(`API request to ${path} failed with status ${status}`)
    this.name = 'ApiError'
  }
}

let mockingStarted: Promise<unknown> | undefined

async function mockingReady() {
  if (isMockingEnabled && typeof window !== 'undefined') {
    if (!mockingStarted) {
      const starting = import('./mock-worker').then(({ startMockWorker }) => startMockWorker())
      mockingStarted = starting
      void starting.catch(() => {
        mockingStarted = undefined
      })
    }

    await mockingStarted
  }
}

async function send(path: string, search: string, init: RequestInit) {
  await mockingReady()

  const response = await fetch(`${apiUrl}${path}${search}`, { ...init, credentials: 'include' })

  if (!response.ok) {
    throw new ApiError(response.status, path, await response.text().catch(() => ''))
  }

  return response
}

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
  const search = query ? `?${toSearchParams(query)}` : ''

  const response = await send(path, search, {
    method: endpoint.method,
    ...(endpoint.body && {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(endpoint.body.parse(body)),
    }),
  })

  return endpoint.response.parse(response.status === 204 ? undefined : await response.json())
}

export async function openLiveEvents() {
  await mockingReady()

  return new EventSource(`${apiUrl}${liveEventsEndpoint.path}`)
}

export function getSession() {
  return request(sessionEndpoint)
}

export function signIn(body: SignInBody) {
  return request(signInEndpoint, { body })
}

export function signOut() {
  return request(signOutEndpoint)
}

export function signInToShowcase() {
  return request(showcaseSignInEndpoint)
}

export function isUnauthorized(error: Error | null) {
  return error instanceof ApiError && error.status === 401
}

export function isConflict(error: Error | null) {
  return error instanceof ApiError && error.status === 409
}

export function getCurrentWorkspace() {
  return request(currentWorkspaceEndpoint)
}

export function updateCompanyIdentity(body: CompanyIdentityInput) {
  return request(updateCompanyIdentityEndpoint, { body })
}

export function getWorkspaceSettings() {
  return request(workspaceSettingsEndpoint)
}

export function listWorkspaceMembers() {
  return request(workspaceMembersEndpoint)
}

export function listOperatorWorkspaces() {
  return request(operatorWorkspacesEndpoint)
}

export function createWorkspace(body: WorkspaceInput) {
  return request(createWorkspaceEndpoint, { body })
}

export function listWorkspaceInvites(workspaceId: string) {
  return request(workspaceInvitesEndpoint, {
    path: toPath(workspaceInvitesEndpoint.path, { workspaceId }),
  })
}

export function createInvite(workspaceId: string, body: InviteInput) {
  return request(createInviteEndpoint, {
    path: toPath(createInviteEndpoint.path, { workspaceId }),
    body,
  })
}

export function revokeInvite(workspaceId: string, inviteId: string) {
  return request(revokeInviteEndpoint, {
    path: toPath(revokeInviteEndpoint.path, { workspaceId, inviteId }),
  })
}

export function listOperatorWorkspaceMembers(workspaceId: string) {
  return request(operatorWorkspaceMembersEndpoint, {
    path: toPath(operatorWorkspaceMembersEndpoint.path, { workspaceId }),
  })
}

export function resetSandboxWorkspace(workspaceId: string) {
  return request(resetSandboxWorkspaceEndpoint, {
    path: toPath(resetSandboxWorkspaceEndpoint.path, { workspaceId }),
  })
}

export function getOperatorWorkspaceSettings(workspaceId: string) {
  return request(operatorWorkspaceSettingsEndpoint, {
    path: toPath(operatorWorkspaceSettingsEndpoint.path, { workspaceId }),
  })
}

export function updateOperatorWorkspaceSettings(workspaceId: string, body: WorkspaceSettingsInput) {
  return request(updateOperatorWorkspaceSettingsEndpoint, {
    path: toPath(updateOperatorWorkspaceSettingsEndpoint.path, { workspaceId }),
    body,
  })
}

export function getOverview(query: OverviewQuery) {
  return request(overviewEndpoint, { query })
}

export function listOrderLifecycles(query: OrderLifecycleQuery) {
  return request(orderLifecyclesEndpoint, { query })
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

export function waitForTradingPartner(id: string) {
  return request(waitForTradingPartnerRunEndpoint, {
    path: toPath(waitForTradingPartnerRunEndpoint.path, { id }),
  })
}

export function listInterchanges(query: InterchangeListQuery) {
  return request(interchangesEndpoint, { query })
}

export function listMappingVersions(mappingId: string) {
  return request(mappingVersionsEndpoint, {
    path: toPath(mappingVersionsEndpoint.path, { mappingId }),
  })
}

export function getMappingVersion(mappingId: string, versionId: string) {
  return request(mappingVersionEndpoint, {
    path: toPath(mappingVersionEndpoint.path, { mappingId, versionId }),
  })
}

export function compareMappingVersions(mappingId: string, query: MappingComparisonQuery) {
  return request(mappingComparisonEndpoint, {
    path: toPath(mappingComparisonEndpoint.path, { mappingId }),
    query,
  })
}

export function publishMappingDraft(mappingId: string) {
  return request(publishMappingDraftEndpoint, {
    path: toPath(publishMappingDraftEndpoint.path, { mappingId }),
  })
}

export function acceptAiDraft(id: string) {
  return request(acceptAiDraftEndpoint, { path: toPath(acceptAiDraftEndpoint.path, { id }) })
}

export function getAiBudget() {
  return request(aiBudgetEndpoint)
}

export async function streamAiDraft(
  mappingId: string,
  body: RequestAiDraftBody,
  { signal, onEvent }: { signal: AbortSignal; onEvent: (event: AiDraftEvent) => void },
) {
  const path = toPath(requestAiDraftEndpoint.path, { id: mappingId })

  const response = await send(path, '', {
    method: requestAiDraftEndpoint.method,
    headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
    body: JSON.stringify(requestAiDraftEndpoint.body.parse(body)),
    signal,
  })

  if (!response.body) {
    throw new ApiError(response.status, path)
  }

  for await (const data of eventStreamData(response.body)) {
    const event = parseAiDraftEvent(data)

    if (event) {
      onEvent(event)
    }
  }
}

export function isAiReviewOpen(error: Error | null) {
  return error instanceof ApiError && error.status === aiReviewOpenStatus
}

export function aiBudgetExhaustedProblemOf(error: Error | null): AiBudgetExhaustedProblem | null {
  if (!(error instanceof ApiError) || error.status !== aiBudgetExhaustedStatus) {
    return null
  }

  try {
    const parsed = aiBudgetExhaustedProblemSchema.safeParse(JSON.parse(error.body))

    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

export function listMappings() {
  return request(mappingsEndpoint)
}

export function createMapping(body: CreateMappingBody) {
  return request(createMappingEndpoint, { body })
}

export function getMappingDraft(id: string) {
  return request(mappingDraftEndpoint, { path: toPath(mappingDraftEndpoint.path, { id }) })
}

export function saveMappingDraft(id: string, body: SaveMappingDraftBody) {
  return request(saveMappingDraftEndpoint, {
    path: toPath(saveMappingDraftEndpoint.path, { id }),
    body,
  })
}

export function listMappingSamples(id: string) {
  return request(mappingSamplesEndpoint, { path: toPath(mappingSamplesEndpoint.path, { id }) })
}

export function previewMapping(id: string, body: PreviewMappingBody) {
  return request(mappingPreviewEndpoint, {
    path: toPath(mappingPreviewEndpoint.path, { id }),
    body,
  })
}

export function getDocumentStructure(id: string) {
  return request(documentStructureEndpoint, {
    path: toPath(documentStructureEndpoint.path, { id }),
  })
}

export function listDocumentStructures() {
  return request(documentStructuresEndpoint)
}

export function inferDocumentStructure(origin: DocumentStructureOrigin) {
  return request(inferDocumentStructureEndpoint, { body: origin })
}

export function createDocumentStructure(body: CreateDocumentStructureBody) {
  return request(createDocumentStructureEndpoint, { body })
}

export function updateDocumentStructure(id: string, body: UpdateDocumentStructureBody) {
  return request(updateDocumentStructureEndpoint, {
    path: toPath(updateDocumentStructureEndpoint.path, { id }),
    body,
  })
}

export function documentStructureProblemOf(error: Error | null): DocumentStructureProblem | null {
  if (!(error instanceof ApiError) || error.status !== 422) {
    return null
  }

  try {
    const parsed = documentStructureProblemSchema.safeParse(JSON.parse(error.body))

    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

export function getMessageTypeStructure(messageType: MessageType) {
  return request(messageTypeStructureEndpoint, {
    path: toPath(messageTypeStructureEndpoint.path, { messageType }),
  })
}

export function listPublishedMappingVersions(query: PublishedMappingVersionsQuery) {
  return request(publishedMappingVersionsEndpoint, { query })
}

export function listLookupTables() {
  return request(lookupTablesEndpoint)
}

export function getLookupTable(id: string) {
  return request(lookupTableEndpoint, { path: toPath(lookupTableEndpoint.path, { id }) })
}

export function createLookupTable(body: LookupTableInput) {
  return request(createLookupTableEndpoint, { body })
}

export function updateLookupTable(id: string, body: LookupTableInput) {
  return request(updateLookupTableEndpoint, {
    path: toPath(updateLookupTableEndpoint.path, { id }),
    body,
  })
}

export function deleteLookupTable(id: string) {
  return request(deleteLookupTableEndpoint, {
    path: toPath(deleteLookupTableEndpoint.path, { id }),
  })
}

export function previewLookupTableImport(id: string, body: LookupTableImportBody) {
  return request(lookupTableImportPreviewEndpoint, {
    path: toPath(lookupTableImportPreviewEndpoint.path, { id }),
    body,
  })
}

export function importLookupTable(id: string, body: LookupTableImportBody) {
  return request(importLookupTableEndpoint, {
    path: toPath(importLookupTableEndpoint.path, { id }),
    body,
  })
}

export function listTradingPartners() {
  return request(tradingPartnersEndpoint)
}

export function listTradingPartnerActivities() {
  return request(tradingPartnerActivitiesEndpoint)
}

export function getTradingPartnerActivity(id: string) {
  return request(tradingPartnerActivityEndpoint, {
    path: toPath(tradingPartnerActivityEndpoint.path, { id }),
  })
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

export function sendTestInterchange(id: string) {
  return request(sendTestInterchangeEndpoint, {
    path: toPath(sendTestInterchangeEndpoint.path, { id }),
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

export function testChannel(id: string) {
  return request(testChannelEndpoint, { path: toPath(testChannelEndpoint.path, { id }) })
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

export function submitDocument(body: ManualSubmissionInput) {
  return request(submitDocumentEndpoint, { body })
}
