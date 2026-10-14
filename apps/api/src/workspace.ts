import { eq } from 'drizzle-orm'
import { Context, Effect } from 'effect'

import type { FastifyRequest } from 'fastify'

import { type CompanyIdentityInput, type Workspace, withCheckDigit } from '@edi-bridge/contracts'
import { workspaces } from '@edi-bridge/db'

import { type Database, Db } from './db.js'
import { exactlyOne } from './rows.js'

const developmentWorkspace: Workspace = {
  id: '5f0c3a52-7d1e-4b8a-9c61-2e4f8d9a1b07',
  name: 'Nordwind Handel GmbH',
  gln: withCheckDigit('021234500000'),
}

export class CurrentWorkspace extends Context.Service<CurrentWorkspace, { readonly id: string }>()(
  'CurrentWorkspace',
) {}

export type WorkspaceResolver = (request: FastifyRequest) => string

export const resolveDevelopmentWorkspace: WorkspaceResolver = () => developmentWorkspace.id

const columns = { id: workspaces.id, name: workspaces.name, gln: workspaces.gln }

export async function seedDevelopmentWorkspace(database: Database) {
  await database.insert(workspaces).values(developmentWorkspace).onConflictDoNothing()
}

export const loadCurrentWorkspace = Effect.gen(function* () {
  const db = yield* Db
  const { id } = yield* CurrentWorkspace

  const rows = yield* Effect.promise(() =>
    db.select(columns).from(workspaces).where(eq(workspaces.id, id)),
  )

  return yield* exactlyOne(rows)
})

export const updateCompanyIdentity = ({ gln }: CompanyIdentityInput) =>
  Effect.gen(function* () {
    const db = yield* Db
    const { id } = yield* CurrentWorkspace

    const rows = yield* Effect.promise(() =>
      db.update(workspaces).set({ gln }).where(eq(workspaces.id, id)).returning(columns),
    )

    return yield* exactlyOne(rows)
  })
