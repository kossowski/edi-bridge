import { Effect } from 'effect'
import Fastify from 'fastify'

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

import {
  createTradingPartnerEndpoint,
  currentWorkspaceEndpoint,
  tradingPartnerEndpoint,
  tradingPartnersEndpoint,
  updateCompanyIdentityEndpoint,
  updateTradingPartnerEndpoint,
} from '@edi-bridge/contracts'

import { type Database, Db } from './db.js'
import { parse, type ValidationError } from './parse.js'
import {
  createTradingPartner,
  listTradingPartners,
  loadTradingPartner,
  updateTradingPartner,
} from './trading-partner.js'
import {
  CurrentWorkspace,
  loadCurrentWorkspace,
  resolveDevelopmentWorkspace,
  updateCompanyIdentity,
  type WorkspaceResolver,
} from './workspace.js'

import type { Conflict, NotFound, Unprocessable } from './errors.js'

export type Probe = () => Promise<void>

export interface AppDependencies {
  database: Database
  logger?: boolean
  probes: { postgres: Probe; redis: Probe }
  probeTimeoutMs?: number
  resolveWorkspace?: WorkspaceResolver
}

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
}: AppDependencies): FastifyInstance {
  const app = Fastify({ logger })

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
    effect: Effect.Effect<
      A,
      Conflict | NotFound | Unprocessable | ValidationError,
      CurrentWorkspace | Db
    >,
    status = 200,
  ) =>
    Effect.runPromise(
      effect.pipe(
        Effect.map((body) => reply.code(status).send(body)),
        Effect.catchTags({
          Conflict: (error) => Effect.sync(() => reply.code(409).send({ message: error.message })),
          NotFound: (error) => Effect.sync(() => reply.code(404).send({ message: error.message })),
          ValidationError: (error) =>
            Effect.sync(() => reply.code(400).send({ message: error.message })),
          Unprocessable: (error) =>
            Effect.sync(() => reply.code(422).send({ message: error.message })),
        }),
        Effect.provideService(Db, database),
        Effect.provideService(CurrentWorkspace, { id: resolveWorkspace(request) }),
      ),
    )

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

  app.get<{ Params: { id: string } }>(tradingPartnerEndpoint.path, (request, reply) =>
    respond(request, reply, loadTradingPartner(request.params.id)),
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
      Effect.gen(function* () {
        const existing = yield* loadTradingPartner(request.params.id)
        const input = yield* parse(updateTradingPartnerEndpoint.body, request.body)

        return yield* updateTradingPartner(existing, input)
      }),
    ),
  )

  return app
}
