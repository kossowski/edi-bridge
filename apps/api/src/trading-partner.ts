import { and, count, eq, exists, isNotNull, isNull, type SQL } from 'drizzle-orm'
import { Effect } from 'effect'

import {
  activityDays,
  directions,
  type TradingPartner,
  type TradingPartnerActivity,
  type TradingPartnerActivityDetail,
  type TradingPartnerInput,
} from '@edi-bridge/contracts'
import {
  channels,
  flows,
  tradingPartnerGlnUnique,
  tradingPartners,
  workspaces,
} from '@edi-bridge/db'
import {
  Database as PipelineDatabase,
  sendTestInterchange as sendInPipeline,
} from '@edi-bridge/pipeline'

import { Db, type Database, type Transaction } from './db.js'
import { dayMs } from './duration.js'
import { Conflict, NotFound, Unprocessable } from './errors.js'
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
    testRejectedAt: row.testRejectedAt?.toISOString() ?? null,
    testRejectedRunId: row.testRejectedRunId,
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

const ofTradingPartner = (
  table: typeof channels | typeof flows,
  workspaceId: string,
  tradingPartnerId?: string,
) =>
  inWorkspace(
    table,
    workspaceId,
    tradingPartnerId === undefined ? undefined : eq(table.tradingPartnerId, tradingPartnerId),
  )

const selectChannelAndFlowCounts = async (
  db: Database,
  workspaceId: string,
  tradingPartnerId?: string,
) => {
  const [channelCountOf, flowCountOf] = await Promise.all([
    countsByTradingPartner(db, channels, ofTradingPartner(channels, workspaceId, tradingPartnerId)),
    countsByTradingPartner(db, flows, ofTradingPartner(flows, workspaceId, tradingPartnerId)),
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

// Until the api reports the Channel directions (#235).
const noDirections = { channelDirections: [], neededDirections: [...directions] }

export const listTradingPartnerActivities = Effect.gen(function* () {
  const db = yield* Db
  const workspace = yield* CurrentWorkspace

  const [rows, countsOf] = yield* Effect.promise(() =>
    Promise.all([
      db
        .select({ id: tradingPartners.id, name: tradingPartners.name })
        .from(tradingPartners)
        .where(inWorkspace(tradingPartners, workspace.id)),
      selectChannelAndFlowCounts(db, workspace.id),
    ]),
  )

  return rows
    .toSorted(byName)
    .map(({ id }): TradingPartnerActivity => ({ ...noRuns(id), ...countsOf(id), ...noDirections }))
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

    const [countsOf, flowsOfPartner] = yield* Effect.promise(() =>
      Promise.all([
        selectChannelAndFlowCounts(db, workspace.id, tradingPartnerId),
        db
          .select({ id: flows.id, name: flows.name })
          .from(flows)
          .where(ofTradingPartner(flows, workspace.id, tradingPartnerId)),
      ]),
    )

    return {
      ...noRuns(tradingPartnerId),
      ...countsOf(tradingPartnerId),
      ...noDirections,
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

// canSwitchToProduction in SQL, so the update checks it atomically
const switchableToProduction = (db: Database) =>
  and(
    eq(tradingPartners.testMode, true),
    isNotNull(tradingPartners.gln),
    isNotNull(tradingPartners.testInterchangeSentAt),
    isNotNull(tradingPartners.contrlReceivedAt),
    exists(
      db
        .select({ id: workspaces.id })
        .from(workspaces)
        .where(and(eq(workspaces.id, tradingPartners.workspaceId), isNotNull(workspaces.gln))),
    ),
  )

export const switchToProduction = (id: string) =>
  Effect.gen(function* () {
    yield* rejectingInvalidId(id)

    const db = yield* Db
    const workspace = yield* CurrentWorkspace

    const [row] = yield* Effect.promise(() =>
      db
        .update(tradingPartners)
        .set({ testMode: false })
        .where(inWorkspace(tradingPartners, workspace.id, byId(id), switchableToProduction(db)))
        .returning(),
    )

    if (row) {
      return toTradingPartner(row)
    }

    yield* loadTradingPartner(id)

    return yield* new Conflict({ message: 'Onboarding is not complete' })
  })

export const sendTestInterchange = (id: string) =>
  Effect.gen(function* () {
    const { id: tradingPartnerId } = yield* loadTradingPartner(id)

    const db = yield* Db
    const workspace = yield* CurrentWorkspace

    yield* sendInPipeline({ workspaceId: workspace.id, tradingPartnerId }).pipe(
      Effect.provideService(PipelineDatabase, db),
    )

    return yield* loadTradingPartner(id)
  })
