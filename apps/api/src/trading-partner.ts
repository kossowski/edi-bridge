import { and, count, eq, isNull, type SQL } from 'drizzle-orm'
import { Effect } from 'effect'

import {
  activityDays,
  type TradingPartner,
  type TradingPartnerActivity,
  type TradingPartnerActivityDetail,
  type TradingPartnerInput,
} from '@edi-bridge/contracts'
import { channels, flows, tradingPartnerGlnUnique, tradingPartners } from '@edi-bridge/db'

import { Db, type Database, type Transaction } from './db.js'
import { dayMs } from './duration.js'
import { NotFound, Unprocessable } from './errors.js'
import { byName, exactlyOne, inWorkspace, rejectingDuplicate, rejectingInvalidId } from './rows.js'
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

const byId = (id: string) => eq(tradingPartners.id, id)

// glnRequired negated in SQL, so the update checks it atomically
const glnRemovable = and(
  eq(tradingPartners.testMode, true),
  isNull(tradingPartners.testInterchangeSentAt),
)

export const listTradingPartners = Effect.gen(function* () {
  const db = yield* Db
  const workspace = yield* CurrentWorkspace

  const rows = yield* Effect.promise(() =>
    db.select().from(tradingPartners).where(inWorkspace(tradingPartners, workspace.id)),
  )

  return rows.map(toTradingPartner).toSorted(byName)
})

const countsByTradingPartner = async (
  db: Database,
  table: typeof channels | typeof flows,
  where: SQL | undefined,
) => {
  const rows = await db
    .select({ tradingPartnerId: table.tradingPartnerId, count: count() })
    .from(table)
    .where(where)
    .groupBy(table.tradingPartnerId)

  const byTradingPartner = new Map(rows.map((row) => [row.tradingPartnerId, row.count]))

  return (tradingPartnerId: string) => byTradingPartner.get(tradingPartnerId) ?? 0
}

const selectSetups = async (db: Database, workspaceId: string, tradingPartnerId?: string) => {
  const only = (table: typeof channels | typeof flows) =>
    inWorkspace(
      table,
      workspaceId,
      tradingPartnerId === undefined ? undefined : eq(table.tradingPartnerId, tradingPartnerId),
    )

  const [channelCountOf, flowCountOf] = await Promise.all([
    countsByTradingPartner(db, channels, only(channels)),
    countsByTradingPartner(db, flows, only(flows)),
  ])

  return (id: string) => ({ channelCount: channelCountOf(id), flowCount: flowCountOf(id) })
}

// Until Runs exist (#187).
const noRuns = (tradingPartnerId: string) => ({
  tradingPartnerId,
  runsToday: 0,
  openProblems: 0,
  lastActivityAt: null,
})

export const listTradingPartnerActivities = Effect.gen(function* () {
  const db = yield* Db
  const workspace = yield* CurrentWorkspace

  const [rows, setupOf] = yield* Effect.promise(() =>
    Promise.all([
      db
        .select({ id: tradingPartners.id, name: tradingPartners.name })
        .from(tradingPartners)
        .where(inWorkspace(tradingPartners, workspace.id)),
      selectSetups(db, workspace.id),
    ]),
  )

  return rows
    .toSorted(byName)
    .map(({ id }): TradingPartnerActivity => ({ ...noRuns(id), ...setupOf(id) }))
})

const rejectingDuplicateGln = <A>(query: () => Promise<A>) =>
  rejectingDuplicate(
    query,
    [tradingPartnerGlnUnique],
    'Another Trading Partner already uses this GLN',
  )

export const loadTradingPartner = (id: string) =>
  Effect.gen(function* () {
    yield* rejectingInvalidId(id)

    const db = yield* Db
    const workspace = yield* CurrentWorkspace

    const rows = yield* Effect.promise(() =>
      db
        .select()
        .from(tradingPartners)
        .where(inWorkspace(tradingPartners, workspace.id, byId(id))),
    )

    const row = rows[0]

    return row ? toTradingPartner(row) : yield* new NotFound()
  })

const selectTradingPartnerId = (
  db: Database | Transaction,
  workspaceId: string,
  tradingPartnerId: string,
) =>
  db
    .select({ id: tradingPartners.id })
    .from(tradingPartners)
    .where(inWorkspace(tradingPartners, workspaceId, byId(tradingPartnerId)))

const unknownTradingPartner = () => new Unprocessable({ message: 'Unknown Trading Partner' })

export const assertTradingPartnerIn = async (
  tx: Transaction,
  workspaceId: string,
  tradingPartnerId: string | null,
) => {
  if (tradingPartnerId === null) {
    return
  }

  const [found] = await selectTradingPartnerId(tx, workspaceId, tradingPartnerId).for('share')

  if (!found) {
    throw unknownTradingPartner()
  }
}

export const rejectingUnknownTradingPartner = (tradingPartnerId: string) =>
  Effect.gen(function* () {
    const db = yield* Db
    const workspace = yield* CurrentWorkspace

    const [found] = yield* Effect.promise(() =>
      selectTradingPartnerId(db, workspace.id, tradingPartnerId),
    )

    if (!found) {
      return yield* unknownTradingPartner()
    }
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

const lastUtcDays = (now: number) =>
  Array.from({ length: activityDays }, (_, index) => ({
    date: new Date(now - (activityDays - 1 - index) * dayMs).toISOString().slice(0, 10),
    runs: 0,
    failed: 0,
  }))

export const loadTradingPartnerActivity = (id: string) =>
  Effect.gen(function* () {
    const { id: tradingPartnerId } = yield* loadTradingPartner(id)
    const now = yield* Effect.sync(() => Date.now())

    const db = yield* Db
    const workspace = yield* CurrentWorkspace

    const [setupOf, flowsOfPartner] = yield* Effect.promise(() =>
      Promise.all([
        selectSetups(db, workspace.id, tradingPartnerId),
        db
          .select({ id: flows.id, name: flows.name })
          .from(flows)
          .where(inWorkspace(flows, workspace.id, eq(flows.tradingPartnerId, tradingPartnerId))),
      ]),
    )

    return {
      ...noRuns(tradingPartnerId),
      ...setupOf(tradingPartnerId),
      days: lastUtcDays(now),
      flows: flowsOfPartner.toSorted(byName).map((flow) => ({ flow, runs: 0 })),
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
        .where(
          inWorkspace(
            tradingPartners,
            workspace.id,
            byId(id),
            changes.gln === null ? glnRemovable : undefined,
          ),
        )
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
