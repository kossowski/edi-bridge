import cors from '@fastify/cors'
import { Effect, Match, Predicate } from 'effect'
import Fastify from 'fastify'

import type { LanguageModel } from 'ai'
import type { FastifyInstance, FastifyReply, FastifyRequest, FastifyServerOptions } from 'fastify'

import { ChannelReach, channelReach, secretBox } from '@edi-bridge/channels'
import {
  acceptAiDraftEndpoint,
  acceptAiProposedPartsEndpoint,
  acceptInviteEndpoint,
  aiBudgetEndpoint,
  type AiBudgetExhaustedProblem,
  aiBudgetExhaustedStatus,
  aiReviewOpenStatus,
  channelEndpoint,
  channelsEndpoint,
  createChannelEndpoint,
  receiveWebhookEndpoint,
  regenerateWebhookTokenEndpoint,
  testChannelEndpoint,
  testInterchangeRefusedProblem,
  testInterchangeRefusedStatus,
  updateChannelEndpoint,
  createDocumentStructureEndpoint,
  createFlowEndpoint,
  createInviteEndpoint,
  createLookupTableEndpoint,
  createMappingEndpoint,
  createTradingPartnerEndpoint,
  currentWorkspaceEndpoint,
  firstStepsEndpoint,
  homeEndpoint,
  deleteLookupTableEndpoint,
  endWaitingForTradingPartnerRunEndpoint,
  documentStructureEndpoint,
  documentStructuresEndpoint,
  documentUndecodableStatus,
  flowEndpoint,
  flowsEndpoint,
  inferDocumentStructureEndpoint,
  interchangeEndpoint,
  interchangesEndpoint,
  importLookupTableEndpoint,
  inviteUnusableProblem,
  inviteUnusableStatus,
  lookupTableEndpoint,
  lookupTableImportPreviewEndpoint,
  lookupTableMissingCodesEndpoint,
  lookupTableSuggestionsEndpoint,
  liveEventsEndpoint,
  lookupTablesEndpoint,
  maxEncodedFileBytes,
  mappingComparisonEndpoint,
  mappingDraftEndpoint,
  mappingPreviewEndpoint,
  mappingSamplesEndpoint,
  mappingsEndpoint,
  maxLookupTableCsvLength,
  mappingVersionEndpoint,
  mappingVersionsEndpoint,
  maxDocumentBytes,
  messageTypeStructureEndpoint,
  moveFlowMappingVersionEndpoint,
  operatorWorkspaceMembersEndpoint,
  operatorWorkspacesEndpoint,
  createWorkspaceEndpoint,
  operatorWorkspaceSettingsEndpoint,
  orderLifecycleEndpoint,
  orderLifecyclesEndpoint,
  publishedMappingVersionsEndpoint,
  publishMappingDraftEndpoint,
  removeWorkspaceMemberEndpoint,
  resetSandboxWorkspaceEndpoint,
  requestAiDraftEndpoint,
  restoreMappingVersionEndpoint,
  reprocessRunEndpoint,
  revokeInviteEndpoint,
  retryRunEndpoint,
  runEndpoint,
  runsEndpoint,
  saveMappingDraftEndpoint,
  sendTestInterchangeEndpoint,
  sessionEndpoint,
  submitDocumentEndpoint,
  tasksEndpoint,
  tradingPartnerActivitiesEndpoint,
  tradingPartnerActivityEndpoint,
  tradingPartnerEndpoint,
  tradingPartnersEndpoint,
  switchToProductionEndpoint,
  updateLookupTableEndpoint,
  updateCompanyIdentityEndpoint,
  updateOperatorWorkspaceSettingsEndpoint,
  updateWorkspaceSettingsEndpoint,
  updateDocumentStructureEndpoint,
  updateFlowEndpoint,
  updateTradingPartnerEndpoint,
  waitForTradingPartnerRunEndpoint,
  webhookTokenHeader,
  workspaceInvitesEndpoint,
  workspaceMembersEndpoint,
  workspaceSettingsEndpoint,
} from '@edi-bridge/contracts'
import {
  LiveEvents,
  type ReceiptRejected,
  type ReceiptRejection,
  RunQueue,
  type RunQueueService,
  type TestInterchangeRefused,
} from '@edi-bridge/pipeline'

import { loadAiBudget } from './ai-budget.js'
import { requestAiDraft } from './ai-draft-request.js'
import { acceptAiDraft, acceptAiProposedParts } from './ai-review.js'
import { type AuthSettings, mountAuth } from './auth.js'
import {
  ChannelEnvironment,
  type ChannelSettings,
  createChannel,
  listChannels,
  loadChannel,
  regenerateWebhookToken,
  testChannel,
  updateChannel,
} from './channel.js'
import { type Database, Db } from './db.js'
import {
  createDocumentStructure,
  inferDocumentStructureOrReject,
  listDocumentStructures,
  loadDocumentStructure,
  updateDocumentStructure,
} from './document-structure.js'
import { loadFirstSteps } from './first-steps.js'
import { createFlow, listFlows, loadFlow, moveFlowMappingVersion, updateFlow } from './flow.js'
import { loadHome } from './home.js'
import { listInterchanges, loadInterchange } from './interchange.js'
import { acceptInvite, createInvite, listInvites, revokeInvite } from './invite.js'
import {
  defaultHeartbeatMs,
  type LiveEventHub,
  liveEventStreams,
  silentLiveEvents,
} from './live-events.js'
import {
  createLookupTable,
  deleteLookupTable,
  importLookupTable,
  listLookupTableMissingCodes,
  listLookupTables,
  loadLookupTable,
  previewLookupTableImport,
  suggestLookupTableEntries,
  updateLookupTable,
} from './lookup-table.js'
import { submitDocument } from './manual-submission.js'
import { listMappingSamples, previewMapping } from './mapping-preview.js'
import {
  compareMappingVersions,
  listMappingVersions,
  listPublishedMappingVersions,
  loadMappingVersion,
  publishMappingDraft,
  restoreMappingVersion,
} from './mapping-version.js'
import { createMapping, listMappings, loadMappingDraft, saveMappingDraft } from './mapping.js'
import { loadMessageTypeStructure } from './message-type.js'
import {
  createWorkspace,
  listWorkspaceSummaries,
  resetSandboxWorkspace,
} from './operator-workspaces.js'
import { listOrderLifecycles, loadOrderLifecycles } from './order-lifecycle.js'
import { parse, type ValidationError } from './parse.js'
import {
  endWaitingForTradingPartnerRun,
  listRuns,
  loadRun,
  reprocessRun,
  retryRun,
  waitForTradingPartnerRun,
} from './run.js'
import {
  CurrentMember,
  CurrentUser,
  loadSession,
  recordActivity,
  requireChangeRight,
  requireOperator,
  requireOperatorRight,
  resolveMember,
  resolveUser,
} from './session.js'
import { listTasks } from './task.js'
import {
  createTradingPartner,
  listTradingPartnerActivities,
  listTradingPartners,
  loadTradingPartner,
  loadTradingPartnerActivity,
  sendTestInterchange,
  switchToProduction,
  updateTradingPartner,
} from './trading-partner.js'
import { WebhookRateLimit, type WebhookRateLimiter } from './webhook-rate-limit.js'
import { bearerTokenSchema, receiveOnWebhook } from './webhook.js'
import {
  listCurrentMembers,
  listWorkspaceMembers,
  removeWorkspaceMember,
} from './workspace-member.js'
import { loadWorkspaceSettings, updateWorkspaceSettings } from './workspace-settings.js'
import {
  CurrentWorkspace,
  forExistingWorkspace,
  loadCurrentWorkspace,
  updateCompanyIdentity,
} from './workspace.js'

import type {
  AiBudgetExhausted,
  AiReviewOpen,
  Conflict,
  DocumentStructureRejected,
  DocumentUndecodable,
  Forbidden,
  InviteUnusable,
  NotFound,
  RateLimited,
  Unauthorized,
  Unprocessable,
} from './errors.js'

export type Probe = () => Promise<void>

export interface AppDependencies {
  aiModel?: LanguageModel | null
  auth: AuthSettings
  channels: ChannelSettings
  database: Database
  liveEventHeartbeatMs?: number | undefined
  liveEvents?: LiveEventHub
  logger?: FastifyServerOptions['logger']
  probes: { postgres: Probe; redis: Probe }
  probeTimeoutMs?: number
  runQueue: RunQueueService
  webOrigin?: string | undefined
  webhookRateLimiter: WebhookRateLimiter
}

type Failure =
  | AiBudgetExhausted
  | AiReviewOpen
  | Conflict
  | DocumentStructureRejected
  | DocumentUndecodable
  | Forbidden
  | InviteUnusable
  | NotFound
  | RateLimited
  | ReceiptRejected
  | TestInterchangeRefused
  | Unauthorized
  | Unprocessable
  | ValidationError

const statusOfReceiptRejection: Record<ReceiptRejection, number> = {
  unknownChannel: 422,
  outboundChannel: 422,
  noFlow: 422,
  noRoutedMessage: 422,
  ambiguousFlow: 422,
}

const statusOfTag: Record<Exclude<Failure['_tag'], 'ReceiptRejected'>, number> = {
  ValidationError: 400,
  Unauthorized: 401,
  Forbidden: 403,
  NotFound: 404,
  Conflict: 409,
  RateLimited: 429,
  InviteUnusable: inviteUnusableStatus,
  Unprocessable: 422,
  DocumentStructureRejected: 422,
  DocumentUndecodable: documentUndecodableStatus,
  AiReviewOpen: aiReviewOpenStatus,
  AiBudgetExhausted: aiBudgetExhaustedStatus,
  TestInterchangeRefused: testInterchangeRefusedStatus,
}

const statusOf = Match.type<Failure>().pipe(
  Match.tag('ReceiptRejected', ({ reason }) => statusOfReceiptRejection[reason]),
  Match.orElse((error) => statusOfTag[error._tag]),
)

const bodyOf = (error: Failure) => {
  if (
    Predicate.isTagged(error, 'DocumentStructureRejected') ||
    Predicate.isTagged(error, 'DocumentUndecodable')
  ) {
    return error.problem
  }

  if (Predicate.isTagged(error, 'AiBudgetExhausted')) {
    return {
      code: 'aiBudgetExhausted',
      message: error.message,
      budget: error.budget,
    } satisfies AiBudgetExhaustedProblem
  }

  if (Predicate.isTagged(error, 'TestInterchangeRefused')) {
    return testInterchangeRefusedProblem(error.refusal)
  }

  return Predicate.isTagged(error, 'InviteUnusable')
    ? inviteUnusableProblem(error.reason)
    : { message: error.message }
}

const headersOf = (error: Failure): Record<string, string> =>
  Predicate.isTagged(error, 'RateLimited') ? { 'retry-after': String(error.retryAfterSeconds) } : {}

// JSON escapes a control character in six bytes, the worst case for a CSV of the maximum length.
const lookupTableImportBodyLimit = 6 * maxLookupTableCsvLength + 1024

// Base64 takes 4 characters per 3 bytes; 1 MiB covers the name, labels and JSON around the Document.
const documentStructureBodyLimit = Math.ceil(maxEncodedFileBytes / 3) * 4 + 1024 * 1024

// Base64 takes 4 characters per 3 bytes; 4 KiB covers the file name, escaped, and the JSON around.
const manualSubmissionBodyLimit = Math.ceil(maxDocumentBytes / 3) * 4 + 4096

// Fastify buffers the body before the token check.
const webhookBodyLimit = maxDocumentBytes

const eventStreamHeaders = { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' }

const readMethods = new Set(['GET', 'HEAD'])

// A preview takes the graph in its body, but changes nothing.
export const readsWithBody = new Set<string>([mappingPreviewEndpoint.path])

type CheckStatus = 'down' | 'up'

const check = (probe: Probe, timeoutMs: number): Promise<CheckStatus> =>
  Promise.race([
    probe(),
    new Promise((_resolve, reject) => {
      setTimeout(() => {
        reject(new Error('probe timed out'))
      }, timeoutMs).unref()
    }),
  ]).then(
    () => 'up',
    () => 'down',
  )

export function buildApp(dependencies: AppDependencies): FastifyInstance {
  const app = Fastify({ logger: dependencies.logger ?? false })

  void app.register(cors, {
    origin: dependencies.webOrigin ? [dependencies.webOrigin] : false,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
  })

  void app.register((scope, _options, done) => {
    registerRoutes(scope, dependencies)
    done()
  })

  return app
}

function registerRoutes(
  app: FastifyInstance,
  {
    aiModel = null,
    auth: authSettings,
    channels: channelSettings,
    database,
    liveEventHeartbeatMs = defaultHeartbeatMs,
    liveEvents = silentLiveEvents,
    probes,
    probeTimeoutMs = 2000,
    runQueue,
    webOrigin,
    webhookRateLimiter,
  }: AppDependencies,
) {
  const inviteOrigin = webOrigin ?? new URL(authSettings.baseUrl).origin

  const channelEnvironment = {
    secrets: secretBox(channelSettings.secretKey),
    apiPublicUrl: channelSettings.apiPublicUrl,
  }

  const reach = channelReach({ timeoutMs: channelSettings.reachTimeoutMs })

  app.get('/health', { logLevel: 'silent' }, async (_request, reply) => {
    const [postgres, redis] = await Promise.all([
      check(probes.postgres, probeTimeoutMs),
      check(probes.redis, probeTimeoutMs),
    ])

    const healthy = postgres === 'up' && redis === 'up'

    return reply
      .code(healthy ? 200 : 503)
      .send({ status: healthy ? 'healthy' : 'unhealthy', checks: { postgres, redis } })
  })

  const auth = mountAuth(app, database, authSettings)

  const run = <A>(
    reply: FastifyReply,
    effect: Effect.Effect<A, Failure, ChannelEnvironment | ChannelReach | Db | RunQueue>,
    status: number,
  ) =>
    Effect.runPromise(
      effect.pipe(
        Effect.map((body) => reply.code(status).send(body)),
        Effect.catch((error) =>
          Effect.sync(() =>
            reply.code(statusOf(error)).headers(headersOf(error)).send(bodyOf(error)),
          ),
        ),
        Effect.provideService(Db, database),
        Effect.provideService(ChannelEnvironment, channelEnvironment),
        Effect.provideService(ChannelReach, reach),
        Effect.provideService(RunQueue, runQueue),
        Effect.provideService(LiveEvents, liveEvents.service),
      ),
    )

  const unauthorized = (reply: FastifyReply) => reply.code(401).send({ message: 'Unauthorized' })

  const respond = async <A>(
    request: FastifyRequest,
    reply: FastifyReply,
    effect: Effect.Effect<
      A,
      Failure,
      ChannelEnvironment | ChannelReach | CurrentMember | CurrentWorkspace | Db | RunQueue
    >,
    status = 200,
  ) => {
    const member = await resolveMember(auth, database, request)

    if (member === undefined) {
      return unauthorized(reply)
    }

    const active = Effect.andThen(recordActivity, effect)

    const guarded =
      readMethods.has(request.method) || readsWithBody.has(request.routeOptions.url ?? '')
        ? active
        : Effect.andThen(requireChangeRight, active)

    return run(
      reply,
      guarded.pipe(
        Effect.provideService(CurrentMember, member),
        Effect.provideService(CurrentWorkspace, { id: member.workspaceId }),
      ),
      status,
    )
  }

  const respondToOperator = async <A>(
    request: FastifyRequest,
    reply: FastifyReply,
    effect: Effect.Effect<A, Failure, ChannelEnvironment | CurrentUser | Db>,
    status = 200,
  ) => {
    const user = await resolveUser(auth, database, request)

    if (user === undefined) {
      return unauthorized(reply)
    }

    return run(
      reply,
      Effect.andThen(requireOperator, effect).pipe(Effect.provideService(CurrentUser, user)),
      status,
    )
  }

  app.get(sessionEndpoint.path, (request, reply) => respond(request, reply, loadSession))

  const eventStreams = liveEventStreams(liveEvents, liveEventHeartbeatMs)

  app.addHook('preClose', (done) => {
    eventStreams.endAll()
    done()
  })

  app.get(liveEventsEndpoint.path, async (request, reply) => {
    const member = await resolveMember(auth, database, request)

    if (member === undefined) {
      return unauthorized(reply)
    }

    const stillMember = async () =>
      (await resolveMember(auth, database, request))?.workspaceId === member.workspaceId

    return eventStreams.stream(reply, member.workspaceId, stillMember)
  })

  app.get(currentWorkspaceEndpoint.path, (request, reply) =>
    respond(request, reply, loadCurrentWorkspace),
  )

  app.get(firstStepsEndpoint.path, (request, reply) => respond(request, reply, loadFirstSteps))

  app.put(updateCompanyIdentityEndpoint.path, (request, reply) =>
    respond(
      request,
      reply,
      Effect.flatMap(
        parse(updateCompanyIdentityEndpoint.body, request.body),
        updateCompanyIdentity,
      ),
    ),
  )

  app.get(workspaceSettingsEndpoint.path, (request, reply) =>
    respond(request, reply, loadWorkspaceSettings),
  )

  app.put(updateWorkspaceSettingsEndpoint.path, (request, reply) =>
    respond(
      request,
      reply,
      requireOperatorRight.pipe(
        Effect.andThen(parse(updateWorkspaceSettingsEndpoint.body, request.body)),
        Effect.flatMap(updateWorkspaceSettings),
      ),
    ),
  )

  // Viewers have no AI access, so they don't see the budget either.
  app.get(aiBudgetEndpoint.path, (request, reply) =>
    respond(request, reply, Effect.andThen(requireChangeRight, loadAiBudget)),
  )

  app.get(workspaceMembersEndpoint.path, (request, reply) =>
    respond(request, reply, listCurrentMembers),
  )

  app.get(tradingPartnersEndpoint.path, (request, reply) =>
    respond(request, reply, listTradingPartners),
  )

  app.get(tradingPartnerActivitiesEndpoint.path, (request, reply) =>
    respond(request, reply, listTradingPartnerActivities),
  )

  app.get<{ Params: { id: string } }>(tradingPartnerEndpoint.path, (request, reply) =>
    respond(request, reply, loadTradingPartner(request.params.id)),
  )

  app.get<{ Params: { id: string } }>(tradingPartnerActivityEndpoint.path, (request, reply) =>
    respond(request, reply, loadTradingPartnerActivity(request.params.id)),
  )

  app.post(createTradingPartnerEndpoint.path, (request, reply) =>
    respond(
      request,
      reply,
      Effect.flatMap(parse(createTradingPartnerEndpoint.body, request.body), createTradingPartner),
      201,
    ),
  )

  app.put<{ Params: { id: string } }>(updateTradingPartnerEndpoint.path, (request, reply) =>
    respond(
      request,
      reply,
      updateTradingPartner(
        request.params.id,
        parse(updateTradingPartnerEndpoint.body, request.body),
      ),
    ),
  )

  app.post<{ Params: { id: string } }>(switchToProductionEndpoint.path, (request, reply) =>
    respond(request, reply, switchToProduction(request.params.id)),
  )

  app.post<{ Params: { id: string } }>(sendTestInterchangeEndpoint.path, (request, reply) =>
    respond(request, reply, sendTestInterchange(request.params.id)),
  )

  app.get(channelsEndpoint.path, (request, reply) => respond(request, reply, listChannels))

  app.get<{ Params: { id: string } }>(channelEndpoint.path, (request, reply) =>
    respond(request, reply, loadChannel(request.params.id)),
  )

  app.post(createChannelEndpoint.path, (request, reply) =>
    respond(
      request,
      reply,
      Effect.flatMap(parse(createChannelEndpoint.body, request.body), createChannel),
      201,
    ),
  )

  app.put<{ Params: { id: string } }>(updateChannelEndpoint.path, (request, reply) =>
    respond(
      request,
      reply,
      updateChannel(request.params.id, parse(updateChannelEndpoint.body, request.body)),
    ),
  )

  app.post<{ Params: { id: string } }>(regenerateWebhookTokenEndpoint.path, (request, reply) =>
    respond(request, reply, regenerateWebhookToken(request.params.id)),
  )

  app.post<{ Params: { id: string } }>(testChannelEndpoint.path, (request, reply) =>
    respond(request, reply, testChannel(request.params.id)),
  )

  app.get(flowsEndpoint.path, (request, reply) => respond(request, reply, listFlows))

  app.get<{ Params: { id: string } }>(flowEndpoint.path, (request, reply) =>
    respond(request, reply, loadFlow(request.params.id)),
  )

  app.post(createFlowEndpoint.path, (request, reply) =>
    respond(
      request,
      reply,
      Effect.flatMap(parse(createFlowEndpoint.body, request.body), createFlow),
      201,
    ),
  )

  app.put<{ Params: { id: string } }>(updateFlowEndpoint.path, (request, reply) =>
    respond(
      request,
      reply,
      updateFlow(request.params.id, parse(updateFlowEndpoint.body, request.body)),
    ),
  )

  app.post<{ Params: { id: string } }>(moveFlowMappingVersionEndpoint.path, (request, reply) =>
    respond(
      request,
      reply,
      moveFlowMappingVersion(
        request.params.id,
        parse(moveFlowMappingVersionEndpoint.body, request.body),
      ),
    ),
  )

  app.post(
    submitDocumentEndpoint.path,
    { bodyLimit: manualSubmissionBodyLimit },
    (request, reply) =>
      respond(
        request,
        reply,
        Effect.flatMap(parse(submitDocumentEndpoint.body, request.body), submitDocument),
        201,
      ),
  )

  // Senders post the Document itself, so the route takes any content type as raw bytes.
  void app.register((webhooks, _options, done) => {
    webhooks.removeAllContentTypeParsers()
    webhooks.addContentTypeParser('*', { parseAs: 'buffer' }, (_request, body, parsed) => {
      parsed(null, body)
    })

    webhooks.post<{ Params: { id: string }; Body: Buffer }>(
      receiveWebhookEndpoint.path,
      { bodyLimit: webhookBodyLimit },
      (request, reply) =>
        run(
          reply,
          receiveOnWebhook(
            request.params.id,
            bearerTokenSchema.safeParse(request.headers[webhookTokenHeader.toLowerCase()]).data,
            request.body,
            request.headers['content-type'],
          ).pipe(Effect.provideService(WebhookRateLimit, webhookRateLimiter)),
          201,
        ),
    )

    done()
  })

  app.get(orderLifecyclesEndpoint.path, (request, reply) =>
    respond(
      request,
      reply,
      Effect.flatMap(parse(orderLifecyclesEndpoint.query, request.query), listOrderLifecycles),
    ),
  )

  app.get<{ Params: { businessReference: string } }>(
    orderLifecycleEndpoint.path,
    (request, reply) =>
      respond(request, reply, loadOrderLifecycles(request.params.businessReference)),
  )

  app.get(tasksEndpoint.path, (request, reply) => respond(request, reply, listTasks))

  app.get(homeEndpoint.path, (request, reply) =>
    respond(request, reply, Effect.flatMap(parse(homeEndpoint.query, request.query), loadHome)),
  )

  app.get(interchangesEndpoint.path, (request, reply) =>
    respond(
      request,
      reply,
      Effect.flatMap(parse(interchangesEndpoint.query, request.query), listInterchanges),
    ),
  )

  app.get<{ Params: { id: string } }>(interchangeEndpoint.path, (request, reply) =>
    respond(request, reply, loadInterchange(request.params.id)),
  )

  app.get(runsEndpoint.path, (request, reply) =>
    respond(request, reply, Effect.flatMap(parse(runsEndpoint.query, request.query), listRuns)),
  )

  app.get<{ Params: { id: string } }>(runEndpoint.path, (request, reply) =>
    respond(request, reply, loadRun(request.params.id)),
  )

  app.post<{ Params: { id: string } }>(retryRunEndpoint.path, (request, reply) =>
    respond(request, reply, retryRun(request.params.id)),
  )

  app.post<{ Params: { id: string } }>(waitForTradingPartnerRunEndpoint.path, (request, reply) =>
    respond(request, reply, waitForTradingPartnerRun(request.params.id)),
  )

  app.delete<{ Params: { id: string } }>(
    endWaitingForTradingPartnerRunEndpoint.path,
    (request, reply) => respond(request, reply, endWaitingForTradingPartnerRun(request.params.id)),
  )

  app.post<{ Params: { id: string } }>(reprocessRunEndpoint.path, (request, reply) =>
    respond(
      request,
      reply,
      Effect.flatMap(parse(reprocessRunEndpoint.body, request.body), (body) =>
        reprocessRun(request.params.id, body),
      ),
      201,
    ),
  )

  app.get(lookupTablesEndpoint.path, (request, reply) => respond(request, reply, listLookupTables))

  app.get(lookupTableSuggestionsEndpoint.path, (request, reply) =>
    respond(
      request,
      reply,
      Effect.flatMap(
        parse(lookupTableSuggestionsEndpoint.query, request.query),
        suggestLookupTableEntries,
      ),
    ),
  )

  app.get<{ Params: { id: string } }>(lookupTableEndpoint.path, (request, reply) =>
    respond(request, reply, loadLookupTable(request.params.id)),
  )

  app.get<{ Params: { id: string } }>(lookupTableMissingCodesEndpoint.path, (request, reply) =>
    respond(request, reply, listLookupTableMissingCodes(request.params.id)),
  )

  app.post(createLookupTableEndpoint.path, (request, reply) =>
    respond(
      request,
      reply,
      Effect.flatMap(parse(createLookupTableEndpoint.body, request.body), createLookupTable),
      201,
    ),
  )

  app.put<{ Params: { id: string } }>(updateLookupTableEndpoint.path, (request, reply) =>
    respond(
      request,
      reply,
      updateLookupTable(request.params.id, parse(updateLookupTableEndpoint.body, request.body)),
    ),
  )

  app.delete<{ Params: { id: string } }>(deleteLookupTableEndpoint.path, (request, reply) =>
    respond(request, reply, deleteLookupTable(request.params.id), 204),
  )

  app.post<{ Params: { id: string } }>(
    lookupTableImportPreviewEndpoint.path,
    { bodyLimit: lookupTableImportBodyLimit },
    (request, reply) =>
      respond(
        request,
        reply,
        previewLookupTableImport(
          request.params.id,
          parse(lookupTableImportPreviewEndpoint.body, request.body),
        ),
      ),
  )

  app.post<{ Params: { id: string } }>(
    importLookupTableEndpoint.path,
    { bodyLimit: lookupTableImportBodyLimit },
    (request, reply) =>
      respond(
        request,
        reply,
        importLookupTable(request.params.id, parse(importLookupTableEndpoint.body, request.body)),
      ),
  )

  app.post(
    inferDocumentStructureEndpoint.path,
    { bodyLimit: documentStructureBodyLimit },
    (request, reply) =>
      respond(
        request,
        reply,
        Effect.flatMap(
          parse(inferDocumentStructureEndpoint.body, request.body),
          inferDocumentStructureOrReject,
        ),
      ),
  )

  app.post(
    createDocumentStructureEndpoint.path,
    { bodyLimit: documentStructureBodyLimit },
    (request, reply) =>
      respond(
        request,
        reply,
        Effect.flatMap(
          parse(createDocumentStructureEndpoint.body, request.body),
          createDocumentStructure,
        ),
        201,
      ),
  )

  app.get(documentStructuresEndpoint.path, (request, reply) =>
    respond(request, reply, listDocumentStructures),
  )

  app.get<{ Params: { id: string } }>(documentStructureEndpoint.path, (request, reply) =>
    respond(request, reply, loadDocumentStructure(request.params.id)),
  )

  app.put<{ Params: { id: string } }>(
    updateDocumentStructureEndpoint.path,
    { bodyLimit: documentStructureBodyLimit },
    (request, reply) =>
      respond(
        request,
        reply,
        updateDocumentStructure(
          request.params.id,
          parse(updateDocumentStructureEndpoint.body, request.body),
        ),
      ),
  )

  app.get<{ Params: { messageType: string } }>(
    messageTypeStructureEndpoint.path,
    (request, reply) =>
      respond(request, reply, loadMessageTypeStructure(request.params.messageType)),
  )

  app.get(mappingsEndpoint.path, (request, reply) => respond(request, reply, listMappings))

  app.post(createMappingEndpoint.path, (request, reply) =>
    respond(
      request,
      reply,
      Effect.flatMap(parse(createMappingEndpoint.body, request.body), createMapping),
      201,
    ),
  )

  app.get<{ Params: { id: string } }>(mappingDraftEndpoint.path, (request, reply) =>
    respond(request, reply, loadMappingDraft(request.params.id)),
  )

  app.put<{ Params: { id: string } }>(saveMappingDraftEndpoint.path, (request, reply) =>
    respond(
      request,
      reply,
      saveMappingDraft(request.params.id, parse(saveMappingDraftEndpoint.body, request.body)),
    ),
  )

  app.post<{ Params: { id: string } }>(requestAiDraftEndpoint.path, (request, reply) =>
    respond(
      request,
      reply,
      Effect.tap(
        requestAiDraft(
          request.params.id,
          parse(requestAiDraftEndpoint.body, request.body),
          aiModel,
          request.log,
        ),
        () => Effect.sync(() => reply.headers(eventStreamHeaders)),
      ),
    ),
  )

  app.post<{ Params: { id: string } }>(acceptAiDraftEndpoint.path, (request, reply) =>
    respond(request, reply, acceptAiDraft(request.params.id)),
  )

  app.post<{ Params: { id: string } }>(acceptAiProposedPartsEndpoint.path, (request, reply) =>
    respond(
      request,
      reply,
      acceptAiProposedParts(
        request.params.id,
        parse(acceptAiProposedPartsEndpoint.body, request.body),
      ),
    ),
  )

  app.get<{ Params: { id: string } }>(mappingSamplesEndpoint.path, (request, reply) =>
    respond(request, reply, listMappingSamples(request.params.id)),
  )

  app.post<{ Params: { id: string } }>(mappingPreviewEndpoint.path, (request, reply) =>
    respond(
      request,
      reply,
      previewMapping(request.params.id, parse(mappingPreviewEndpoint.body, request.body)),
    ),
  )

  app.get(publishedMappingVersionsEndpoint.path, (request, reply) =>
    respond(
      request,
      reply,
      Effect.flatMap(
        parse(publishedMappingVersionsEndpoint.query, request.query),
        listPublishedMappingVersions,
      ),
    ),
  )

  app.get<{ Params: { mappingId: string } }>(mappingVersionsEndpoint.path, (request, reply) =>
    respond(request, reply, listMappingVersions(request.params.mappingId)),
  )

  app.get<{ Params: { mappingId: string; versionId: string } }>(
    mappingVersionEndpoint.path,
    (request, reply) =>
      respond(
        request,
        reply,
        loadMappingVersion(request.params.mappingId, request.params.versionId),
      ),
  )

  app.get<{ Params: { mappingId: string } }>(mappingComparisonEndpoint.path, (request, reply) =>
    respond(
      request,
      reply,
      compareMappingVersions(
        request.params.mappingId,
        parse(mappingComparisonEndpoint.query, request.query),
      ),
    ),
  )

  app.post<{ Params: { mappingId: string } }>(publishMappingDraftEndpoint.path, (request, reply) =>
    respond(
      request,
      reply,
      publishMappingDraft(
        request.params.mappingId,
        parse(publishMappingDraftEndpoint.body, request.body),
      ),
      201,
    ),
  )

  app.post<{ Params: { mappingId: string; versionId: string } }>(
    restoreMappingVersionEndpoint.path,
    (request, reply) =>
      respond(
        request,
        reply,
        restoreMappingVersion(request.params.mappingId, request.params.versionId),
      ),
  )

  app.get(operatorWorkspacesEndpoint.path, (request, reply) =>
    respondToOperator(request, reply, listWorkspaceSummaries),
  )

  app.post(createWorkspaceEndpoint.path, (request, reply) =>
    respondToOperator(
      request,
      reply,
      createWorkspace(parse(createWorkspaceEndpoint.body, request.body)),
      201,
    ),
  )

  app.post<{ Params: { workspaceId: string } }>(
    resetSandboxWorkspaceEndpoint.path,
    (request, reply) =>
      respondToOperator(request, reply, resetSandboxWorkspace(request.params.workspaceId)),
  )

  app.get<{ Params: { workspaceId: string } }>(
    operatorWorkspaceMembersEndpoint.path,
    (request, reply) =>
      respondToOperator(request, reply, listWorkspaceMembers(request.params.workspaceId)),
  )

  app.delete<{ Params: { workspaceId: string; userId: string } }>(
    removeWorkspaceMemberEndpoint.path,
    (request, reply) =>
      respondToOperator(
        request,
        reply,
        removeWorkspaceMember(request.params.workspaceId, request.params.userId),
        204,
      ),
  )

  app.get<{ Params: { workspaceId: string } }>(
    operatorWorkspaceSettingsEndpoint.path,
    (request, reply) =>
      respondToOperator(
        request,
        reply,
        loadWorkspaceSettings.pipe(forExistingWorkspace(request.params.workspaceId)),
      ),
  )

  app.put<{ Params: { workspaceId: string } }>(
    updateOperatorWorkspaceSettingsEndpoint.path,
    (request, reply) =>
      respondToOperator(
        request,
        reply,
        Effect.flatMap(
          parse(updateOperatorWorkspaceSettingsEndpoint.body, request.body),
          updateWorkspaceSettings,
        ).pipe(forExistingWorkspace(request.params.workspaceId)),
      ),
  )

  app.get<{ Params: { workspaceId: string } }>(workspaceInvitesEndpoint.path, (request, reply) =>
    respondToOperator(request, reply, listInvites(request.params.workspaceId, inviteOrigin)),
  )

  app.post<{ Params: { workspaceId: string } }>(createInviteEndpoint.path, (request, reply) =>
    respondToOperator(
      request,
      reply,
      createInvite(
        request.params.workspaceId,
        parse(createInviteEndpoint.body, request.body),
        inviteOrigin,
      ),
      201,
    ),
  )

  app.delete<{ Params: { workspaceId: string; inviteId: string } }>(
    revokeInviteEndpoint.path,
    (request, reply) =>
      respondToOperator(
        request,
        reply,
        revokeInvite(request.params.workspaceId, request.params.inviteId, inviteOrigin),
      ),
  )

  app.post(acceptInviteEndpoint.path, (request, reply) =>
    run(reply, acceptInvite(parse(acceptInviteEndpoint.body, request.body)), 200),
  )
}
