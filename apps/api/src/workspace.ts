import { eq } from 'drizzle-orm'
import { Context, Effect } from 'effect'

import { workspaces } from '@edi-bridge/db'

import type { CompanyIdentityInput } from '@edi-bridge/contracts'

import { Db } from './db.js'
import { exactlyOne } from './rows.js'

export class CurrentWorkspace extends Context.Service<CurrentWorkspace, { readonly id: string }>()(
  'CurrentWorkspace',
) {}

const columns = { id: workspaces.id, name: workspaces.name, gln: workspaces.gln }

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
