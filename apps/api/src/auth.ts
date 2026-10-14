import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { fromNodeHeaders } from 'better-auth/node'

import type { FastifyInstance, FastifyRequest } from 'fastify'

import { accounts, sessions, users, verifications } from '@edi-bridge/db'

import type { Database } from './db.js'

export interface AuthSettings {
  secret: string
  baseUrl: string
  trustedOrigins: string[]
}

const basePath = '/auth'

export function createAuth(database: Database, { secret, baseUrl, trustedOrigins }: AuthSettings) {
  return betterAuth({
    secret,
    baseURL: baseUrl,
    basePath,
    trustedOrigins,
    database: drizzleAdapter(database, {
      provider: 'pg',
      usePlural: true,
      schema: { users, sessions, accounts, verifications },
    }),
    emailAndPassword: { enabled: true, disableSignUp: true },
    disabledPaths: ['/sign-up/email'],
    advanced: { database: { generateId: 'uuid' } },
    telemetry: { enabled: false },
  })
}

export type Auth = ReturnType<typeof createAuth>

export const headersOf = (request: FastifyRequest) => fromNodeHeaders(request.headers)

export function mountAuth(app: FastifyInstance, auth: Auth, baseUrl: string) {
  app.route({
    method: ['GET', 'POST'],
    url: `${basePath}/*`,
    handler: async (request, reply) => {
      const headers = headersOf(request)

      // The body is serialised again below, so the original length no longer applies.
      headers.delete('content-length')

      const response = await auth.handler(
        new Request(new URL(request.url, baseUrl), {
          method: request.method,
          headers,
          ...(request.body !== undefined && { body: JSON.stringify(request.body) }),
        }),
      )

      response.headers.forEach((value, key) => {
        if (key !== 'set-cookie') {
          void reply.header(key, value)
        }
      })

      const cookies = response.headers.getSetCookie()

      if (cookies.length > 0) {
        void reply.header('set-cookie', cookies)
      }

      return reply.code(response.status).send(response.body ? await response.text() : null)
    },
  })
}
