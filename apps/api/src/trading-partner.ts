import { and, count, eq, exists, isNotNull, isNull } from 'drizzle-orm'
import { Effect } from 'effect'

import {
  activityDays,
  channelDirectionsOf,
  neededDirectionsOf,
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
  ...(row.messageTypes !== null && { messageTypes: row.messageTypes }),
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

const groupedByTradingPartner = <Grouped extends { tradingPartnerId: string | null }>(
  rows: Grouped[],
) => {
  const byTradingPartner = Map.groupBy(rows, (row) => row.tradingPartnerId)

  return (tradingPartnerId: string) => byTradingPartner.get(tradingPartnerId) ?? []
}

const sumOf = (rows: ReadonlyArray<{ count: number }>) =>
  rows.reduce((sum, row) => sum + row.count, 0)

const selectChannelsAndFlows = async (
  db: Database,
  workspaceId: string,
  tradingPartnerId?: string,
) => {
  const [channelRows, flowRows] = await Promise.all([
    db
      .select({
        tradingPartnerId: channels.tradingPartnerId,
        direction: channels.direction,
        count: count(),
      })
      .from(channels)
      .where(ofTradingPartner(channels, workspaceId, tradingPartnerId))
      .groupBy(channels.tradingPartnerId, channels.direction),
    db
      .select({
        tradingPartnerId: flows.tradingPartnerId,
        messageType: flows.messageType,
        count: count(),
      })
      .from(flows)
      .where(ofTradingPartner(flows, workspaceId, tradingPartnerId))
      .groupBy(flows.tradingPartnerId, flows.messageType),
  ])

  const channelsOf = groupedByTradingPartner(channelRows)
  const flowsOf = groupedByTradingPartner(flowRows)

  return ({ id, messageTypes }: Pick<Row, 'id' | 'messageTypes'>) => ({
    channelCount: sumOf(channelsOf(id)),
    flowCount: sumOf(flowsOf(id)),
    channelDirections: channelDirectionsOf(channelsOf(id)),
    neededDirections: neededDirectionsOf({ messageTypes, flows: flowsOf(id) }),
  })
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

  const [rows, channelsAndFlowsOf] = yield* Effect.promise(() =>
    Promise.all([
      db
        .select({
          id: tradingPartners.id,
          name: tradingPartners.name,
          messageTypes: tradingPartners.messageTypes,
        })
        .from(tradingPartners)
        .where(inWorkspace(tradingPartners, workspace.id)),
      selectChannelsAndFlows(db, workspace.id),
    ]),
  )

  return rows
    .toSorted(byName)
    .map((row): TradingPartnerActivity => ({ ...noRuns(row.id), ...channelsAndFlowsOf(row) }))
})

const rejectingDuplicateGln = <A>(query: () => Promise<A>) =>
  rejectingDuplicate(
    query,
    [tradingPartnerGlnUnique],
    'Another Trading Partner already uses this GLN',
  )

const loadTradingPartnerRow = (id: string) =>
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

    return rows[0] ?? (yield* new NotFound())
  })

export const loadTradingPartner = (id: string) =>
  Effect.map(loadTradingPartnerRow(id), toTradingPartner)

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
    const row = yield* loadTradingPartnerRow(id)
    const tradingPartnerId = row.id
    const now = yield* Effect.sync(() => Date.now())

    const db = yield* Db
    const workspace = yield* CurrentWorkspace

    const [channelsAndFlowsOf, flowsOfPartner] = yield* Effect.promise(() =>
      Promise.all([
        selectChannelsAndFlows(db, workspace.id, tradingPartnerId),
        db
          .select({ id: flows.id, name: flows.name })
          .from(flows)
          .where(ofTradingPartner(flows, workspace.id, tradingPartnerId)),
      ]),
    )

    return {
      ...noRuns(tradingPartnerId),
      ...channelsAndFlowsOf(row),
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
