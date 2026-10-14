import { and, DrizzleQueryError, eq, isNull, type SQL } from 'drizzle-orm'
import { Effect } from 'effect'
import postgres from 'postgres'
import { z } from 'zod'

import {
  activityDays,
  type TradingPartner,
  type TradingPartnerActivity,
  type TradingPartnerActivityDetail,
  type TradingPartnerInput,
} from '@edi-bridge/contracts'
import { tradingPartnerGlnUnique, tradingPartners } from '@edi-bridge/db'

import { Db } from './db.js'
import { Conflict, NotFound, Unprocessable } from './errors.js'
import { exactlyOne } from './rows.js'
import { CurrentWorkspace } from './workspace.js'

import type { ValidationError } from './parse.js'

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

const inWorkspace = (workspaceId: string, ...conditions: (SQL | undefined)[]) =>
  and(eq(tradingPartners.workspaceId, workspaceId), ...conditions)

const byId = (id: string) => eq(tradingPartners.id, id)

// glnRequired negated in SQL, so the update checks it atomically
const glnRemovable = and(
  eq(tradingPartners.testMode, true),
  isNull(tradingPartners.testInterchangeSentAt),
)

const nameCollator = new Intl.Collator('de')

export const listTradingPartners = Effect.gen(function* () {
  const db = yield* Db
  const workspace = yield* CurrentWorkspace

  const rows = yield* Effect.promise(() =>
    db.select().from(tradingPartners).where(inWorkspace(workspace.id)),
  )

  return rows.map(toTradingPartner).toSorted((a, b) => nameCollator.compare(a.name, b.name))
})

// Until Runs exist (#187).
export const listTradingPartnerActivities: Effect.Effect<TradingPartnerActivity[]> = Effect.succeed(
  [],
)

const rejectingDuplicateGln = <A>(query: () => Promise<A>) =>
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
        .where(inWorkspace(workspace.id, byId(id))),
    )

    const row = rows[0]

    return row ? toTradingPartner(row) : yield* new NotFound()
  })

export const createTradingPartner = (input: TradingPartnerInput) =>
  Effect.gen(function* () {
    const db = yield* Db
    const workspace = yield* CurrentWorkspace

    const rows = yield* rejectingDuplicateGln(() =>
      db
        .insert(tradingPartners)
        .values({ ...input, workspaceId: workspace.id })
        .returning(),
    )

    return toTradingPartner(yield* exactlyOne(rows))
  })

const dayMs = 24 * 60 * 60 * 1000

const lastUtcDays = (now: number) =>
  Array.from({ length: activityDays }, (_, index) => ({
    date: new Date(now - (activityDays - 1 - index) * dayMs).toISOString().slice(0, 10),
    runs: 0,
    failed: 0,
  }))

// Until Runs exist (#187).
export const loadTradingPartnerActivity = (id: string) =>
  Effect.gen(function* () {
    const { id: tradingPartnerId } = yield* loadTradingPartner(id)
    const now = yield* Effect.sync(() => Date.now())

    return {
      tradingPartnerId,
      runsToday: 0,
      openProblems: 0,
      lastActivityAt: null,
      channelCount: 0,
      flowCount: 0,
      days: lastUtcDays(now),
      flows: [],
      problems: [],
    } satisfies TradingPartnerActivityDetail
  })

export const updateTradingPartner = (
  id: string,
  input: Effect.Effect<TradingPartnerInput, ValidationError>,
) =>
  Effect.gen(function* () {
    yield* loadTradingPartner(id)
    const changes = yield* input

    const db = yield* Db
    const workspace = yield* CurrentWorkspace

    const [row] = yield* rejectingDuplicateGln(() =>
      db
        .update(tradingPartners)
        .set(changes)
        .where(inWorkspace(workspace.id, byId(id), changes.gln === null ? glnRemovable : undefined))
        .returning(),
    )

    if (row) {
      return toTradingPartner(row)
    }

    yield* loadTradingPartner(id)

    return yield* new Unprocessable({
      message: 'The Trading Partner needs its GLN once Interchanges were exchanged',
    })
  })
