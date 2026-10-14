import cors from '@fastify/cors'
import { Effect, Predicate } from 'effect'
import Fastify from 'fastify'

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

import {
  channelsEndpoint,
  createDocumentStructureEndpoint,
  createLookupTableEndpoint,
  createTradingPartnerEndpoint,
  currentWorkspaceEndpoint,
  deleteLookupTableEndpoint,
  documentStructureEndpoint,
  documentStructuresEndpoint,
  inferDocumentStructureEndpoint,
  importLookupTableEndpoint,
  lookupTableEndpoint,
  lookupTableImportPreviewEndpoint,
  lookupTableMissingCodesEndpoint,
  lookupTableSuggestionsEndpoint,
  lookupTablesEndpoint,
  maxEncodedFileBytes,
  maxLookupTableCsvLength,
  sessionEndpoint,
  tradingPartnerActivitiesEndpoint,
  tradingPartnerActivityEndpoint,
  tradingPartnerEndpoint,
  tradingPartnersEndpoint,
  updateLookupTableEndpoint,
  updateCompanyIdentityEndpoint,
  updateDocumentStructureEndpoint,
  updateTradingPartnerEndpoint,
} from '@edi-bridge/contracts'

import { listChannels } from './channel.js'
import { type Database, Db } from './db.js'
import {
  createDocumentStructure,
  inferDocumentStructureOrReject,
  listDocumentStructures,
  loadDocumentStructure,
  updateDocumentStructure,
} from './document-structure.js'
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
import { parse, type ValidationError } from './parse.js'
import { loadDevelopmentSession } from './session.js'
import {
  createTradingPartner,
  listTradingPartnerActivities,
  listTradingPartners,
  loadTradingPartner,
  loadTradingPartnerActivity,
  updateTradingPartner,
} from './trading-partner.js'
import {
  CurrentWorkspace,
  loadCurrentWorkspace,
  resolveDevelopmentWorkspace,
  updateCompanyIdentity,
  type WorkspaceResolver,
} from './workspace.js'

import type { Conflict, DocumentStructureRejected, NotFound, Unprocessable } from './errors.js'

export type Probe = () => Promise<void>

export interface AppDependencies {
  database: Database
  logger?: boolean
  probes: { postgres: Probe; redis: Probe }
  probeTimeoutMs?: number
  resolveWorkspace?: WorkspaceResolver
  webOrigin?: string
}

type Failure = Conflict | DocumentStructureRejected | NotFound | Unprocessable | ValidationError

const statusOf: Record<Failure['_tag'], number> = {
  ValidationError: 400,
  NotFound: 404,
  Conflict: 409,
  Unprocessable: 422,
  DocumentStructureRejected: 422,
}

const bodyOf = (error: Failure) =>
  Predicate.isTagged(error, 'DocumentStructureRejected')
    ? error.problem
    : { message: error.message }

// JSON escapes a control character in six bytes, the worst case for a CSV of the maximum length.
const lookupTableImportBodyLimit = 6 * maxLookupTableCsvLength + 1024

// Base64 takes 4 characters per 3 bytes; 1 MiB covers the name, labels and JSON around the Document.
const documentStructureBodyLimit = Math.ceil(maxEncodedFileBytes / 3) * 4 + 1024 * 1024

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

export function buildApp({
  database,
  logger = false,
  probes,
  probeTimeoutMs = 2000,
  resolveWorkspace = resolveDevelopmentWorkspace,
  webOrigin,
}: AppDependencies): FastifyInstance {
  const app = Fastify({ logger })

  void app.register(cors, {
    origin: webOrigin ? [webOrigin] : false,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
  })

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

  const respond = <A>(
    request: FastifyRequest,
    reply: FastifyReply,
    effect: Effect.Effect<A, Failure, CurrentWorkspace | Db>,
    status = 200,
  ) =>
    Effect.runPromise(
      effect.pipe(
        Effect.map((body) => reply.code(status).send(body)),
        Effect.catch((error) =>
          Effect.sync(() => reply.code(statusOf[error._tag]).send(bodyOf(error))),
        ),
        Effect.provideService(Db, database),
        Effect.provideService(CurrentWorkspace, { id: resolveWorkspace(request) }),
      ),
    )

  app.get(sessionEndpoint.path, (request, reply) => respond(request, reply, loadDevelopmentSession))

  app.get(currentWorkspaceEndpoint.path, (request, reply) =>
    respond(request, reply, loadCurrentWorkspace),
  )

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

  app.get(channelsEndpoint.path, (request, reply) => respond(request, reply, listChannels))

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

  return app
}
