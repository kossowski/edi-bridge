import { and, DrizzleQueryError, eq } from 'drizzle-orm'
import { Effect } from 'effect'
import postgres from 'postgres'
import { z } from 'zod'

import { glnRequired, type TradingPartner, type TradingPartnerInput } from '@edi-bridge/contracts'
import { tradingPartnerGlnUnique, tradingPartners } from '@edi-bridge/db'

import { Db } from './db.js'
import { Conflict, NotFound, Unprocessable } from './errors.js'
import { CurrentWorkspace } from './workspace.js'

type Row = typeof tradingPartners.$inferSelect

const toTradingPartner = (row: Row): TradingPartner => ({
  id: row.id,
  name: row.name,
  gln: row.gln,
  characterSet: row.characterSet,
  acknowledgementTimeLimitHours: row.acknowledgementTimeLimitHours,
  testMode: row.testMode,
  onboarding: {
    testInterchangeSentAt: row.testInterchangeSentAt?.toISOString() ?? null,
    contrlReceivedAt: row.contrlReceivedAt?.toISOString() ?? null,
  },
})

const byName = new Intl.Collator('de')

export const listTradingPartners = Effect.gen(function* () {
  const db = yield* Db
  const workspace = yield* CurrentWorkspace

  const rows = yield* Effect.promise(() =>
    db.select().from(tradingPartners).where(eq(tradingPartners.workspaceId, workspace.id)),
  )

  return rows.map(toTradingPartner).toSorted((a, b) => byName.compare(a.name, b.name))
})

const write = <A>(query: () => Promise<A>) =>
  Effect.promise(query).pipe(
    Effect.catchDefect((defect) =>
      defect instanceof DrizzleQueryError &&
      defect.cause instanceof postgres.PostgresError &&
      defect.cause.constraint_name === tradingPartnerGlnUnique
        ? Effect.fail(new Conflict({ message: 'Another Trading Partner already uses this GLN' }))
        : Effect.die(defect),
    ),
  )

export const loadTradingPartner = (id: string) =>
  Effect.gen(function* () {
    if (!z.uuid().safeParse(id).success) {
      return yield* new NotFound()
    }

    const db = yield* Db
    const workspace = yield* CurrentWorkspace

    const rows = yield* Effect.promise(() =>
      db
        .select()
        .from(tradingPartners)
        .where(and(eq(tradingPartners.workspaceId, workspace.id), eq(tradingPartners.id, id))),
    )

    const row = rows[0]

    return row ? toTradingPartner(row) : yield* new NotFound()
  })

export const createTradingPartner = (input: TradingPartnerInput) =>
  Effect.gen(function* () {
    const db = yield* Db
    const workspace = yield* CurrentWorkspace

    const [row] = yield* write(() =>
      db
        .insert(tradingPartners)
        .values({ ...input, workspaceId: workspace.id })
        .returning(),
    )

    return toTradingPartner(yield* Effect.orDie(Effect.fromNullishOr(row)))
  })

export const updateTradingPartner = (existing: TradingPartner, input: TradingPartnerInput) =>
  Effect.gen(function* () {
    if (input.gln === null && glnRequired(existing)) {
      return yield* new Unprocessable({
        message: 'The Trading Partner needs its GLN once Interchanges were exchanged',
      })
    }

    const db = yield* Db
    const workspace = yield* CurrentWorkspace

    const [row] = yield* write(() =>
      db
        .update(tradingPartners)
        .set(input)
        .where(
          and(eq(tradingPartners.workspaceId, workspace.id), eq(tradingPartners.id, existing.id)),
        )
        .returning(),
    )

    return row ? toTradingPartner(row) : yield* new NotFound()
  })
