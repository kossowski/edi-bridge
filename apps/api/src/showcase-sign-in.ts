import { APIError, createAuthEndpoint, formCsrfMiddleware } from 'better-auth/api'
import { setSessionCookie } from 'better-auth/cookies'
import { eq } from 'drizzle-orm'

import type { BetterAuthPlugin } from 'better-auth'

import { type SignedIn } from '@edi-bridge/contracts'
import { members, users, workspaces } from '@edi-bridge/db'

import { showcaseViewer } from './showcase-and-sandbox.js'

import type { Database } from './db.js'

async function findShowcaseViewer(database: Database) {
  const rows = await database
    .select({
      id: users.id,
      operator: users.operator,
      role: members.role,
      kind: workspaces.kind,
    })
    .from(users)
    .leftJoin(members, eq(members.userId, users.id))
    .leftJoin(workspaces, eq(workspaces.id, members.workspaceId))
    .where(eq(users.email, showcaseViewer.email))

  const [viewer] = rows

  if (viewer === undefined) {
    throw new APIError('NOT_FOUND', { message: 'No Showcase Workspace exists' })
  }

  // Only a read-only Viewer of the Showcase may sign in here; any more rights and it stays shut.
  if (
    rows.length !== 1 ||
    viewer.operator ||
    viewer.role !== 'viewer' ||
    viewer.kind !== 'showcase'
  ) {
    throw new APIError('FORBIDDEN', {
      message: 'The showcase Viewer has rights beyond a Viewer of the Showcase',
    })
  }

  return viewer.id
}

export const showcaseSignIn = (database: Database) =>
  ({
    id: 'showcase-sign-in',
    endpoints: {
      signInShowcase: createAuthEndpoint(
        '/sign-in/showcase',
        // The same origin check as the email sign-in, so no foreign page signs a visitor in.
        { method: 'POST', use: [formCsrfMiddleware] },
        async (ctx) => {
          const user = await ctx.context.internalAdapter.findUserById(
            await findShowcaseViewer(database),
          )

          if (user === null) {
            throw new APIError('NOT_FOUND', { message: 'No Showcase Workspace exists' })
          }

          const session = await ctx.context.internalAdapter.createSession(user.id)

          await setSessionCookie(ctx, { session, user })

          return ctx.json({
            user: { id: user.id, name: user.name, email: user.email },
          } satisfies SignedIn)
        },
      ),
    },
  }) satisfies BetterAuthPlugin
