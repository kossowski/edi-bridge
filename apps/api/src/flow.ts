import { and, eq, inArray } from 'drizzle-orm'
import { Effect } from 'effect'

import {
  fitsFlow,
  type Flow,
  type FlowChannelField,
  flowChannelFields,
  type FlowInput,
  type FlowUpdate,
  type MoveFlowMappingVersionBody,
} from '@edi-bridge/contracts'
import { channels, flows, mappings, mappingVersions } from '@edi-bridge/db'

import { Db, type Database, type Transaction } from './db.js'
import { Conflict, NotFound, Unprocessable } from './errors.js'
import { selectVersions, toHeader } from './mapping-version.js'
import { byName, exactlyOne, inWorkspace, rejectingInvalidId, writingInWorkspace } from './rows.js'
import { assertTradingPartnerIn } from './trading-partner.js'
import { CurrentWorkspace } from './workspace.js'

import type { ValidationError } from './parse.js'

type Row = typeof flows.$inferSelect

const toFlows = async (db: Database, rows: Row[]): Promise<Flow[]> => {
  if (rows.length === 0) {
    return []
  }

  const pinned = new Map(
    (
      await selectVersions(db, {}).where(
        inArray(
          mappingVersions.id,
          rows.map(({ mappingVersionId }) => mappingVersionId),
        ),
      )
    ).map((version) => [version.id, version]),
  )

  const siblings = await selectVersions(db, {}).where(
    inArray(
      mappingVersions.mappingId,
      [...pinned.values()].map(({ mappingId }) => mappingId),
    ),
  )

  return rows.map((row) => {
    const version = pinned.get(row.mappingVersionId)

    if (!version) {
      throw new Error(`Flow ${row.id} pins an unknown Mapping Version`)
    }

    return {
      id: row.id,
      name: row.name,
      tradingPartnerId: row.tradingPartnerId,
      messageType: row.messageType,
      inboundChannelId: row.inboundChannelId,
      destinationChannelId: row.destinationChannelId,
      mappingVersion: toHeader(version),
      newerMappingVersions: siblings
        .filter(
          (candidate) =>
            candidate.mappingId === version.mappingId && candidate.version > version.version,
        )
        .toSorted((a, b) => b.version - a.version)
        .map(toHeader),
    }
  })
}

const byId = (id: string) => eq(flows.id, id)

export const listFlows = Effect.gen(function* () {
  const db = yield* Db
  const workspace = yield* CurrentWorkspace

  const rows = yield* Effect.promise(() =>
    db.select().from(flows).where(inWorkspace(flows, workspace.id)),
  )

  return (yield* Effect.promise(() => toFlows(db, rows))).toSorted(byName)
})

const loadRow = (id: string) =>
  Effect.gen(function* () {
    yield* rejectingInvalidId(id)

    const db = yield* Db
    const workspace = yield* CurrentWorkspace

    const [row] = yield* Effect.promise(() =>
      db
        .select()
        .from(flows)
        .where(inWorkspace(flows, workspace.id, byId(id))),
    )

    return row ?? (yield* new NotFound())
  })

const toFlow = (row: Row) =>
  Effect.gen(function* () {
    const db = yield* Db

    return yield* exactlyOne(yield* Effect.promise(() => toFlows(db, [row])))
  })

export const loadFlow = (id: string) => Effect.flatMap(loadRow(id), toFlow)

const roles = {
  inboundChannelId: 'inbound Channel',
  destinationChannelId: 'destination Channel',
} as const satisfies Record<FlowChannelField, string>

const assertChannelsFit = async (
  tx: Transaction,
  workspaceId: string,
  flow: Pick<FlowInput, 'messageType' | 'tradingPartnerId' | FlowChannelField>,
) => {
  const found = await tx
    .select({
      id: channels.id,
      direction: channels.direction,
      tradingPartnerId: channels.tradingPartnerId,
    })
    .from(channels)
    .where(
      inWorkspace(
        channels,
        workspaceId,
        inArray(
          channels.id,
          flowChannelFields.map((field) => flow[field]),
        ),
      ),
    )
    .for('share')

  for (const field of flowChannelFields) {
    const channel = found.find(({ id }) => id === flow[field])

    if (!channel) {
      throw new Unprocessable({ message: `The ${roles[field]} does not exist` })
    }

    if (!fitsFlow(channel, field, flow)) {
      throw new Unprocessable({
        message: `The ${roles[field]} does not fit the Message Type and Trading Partner of the Flow`,
      })
    }
  }
}

const pinnable = async (
  tx: Transaction,
  workspaceId: string,
  { mappingVersionId, messageType }: Pick<FlowInput, 'mappingVersionId' | 'messageType'>,
) => {
  const [version] = await tx
    .select({ messageType: mappings.messageType })
    .from(mappingVersions)
    .innerJoin(mappings, eq(mappingVersions.mappingId, mappings.id))
    .where(inWorkspace(mappings, workspaceId, eq(mappingVersions.id, mappingVersionId)))

  if (!version) {
    throw new Unprocessable({ message: 'The Mapping Version is not published' })
  }

  if (version.messageType !== messageType) {
    throw new Unprocessable({ message: 'The Mapping Version is for another Message Type' })
  }
}

export const createFlow = (input: FlowInput) =>
  Effect.gen(function* () {
    const rows = yield* writingInWorkspace(async (tx, workspaceId) => {
      await assertTradingPartnerIn(tx, workspaceId, input.tradingPartnerId)
      await pinnable(tx, workspaceId, input)
      await assertChannelsFit(tx, workspaceId, input)

      return tx
        .insert(flows)
        .values({ ...input, workspaceId })
        .returning()
    })

    return yield* toFlow(yield* exactlyOne(rows))
  })

export const updateFlow = (id: string, input: Effect.Effect<FlowUpdate, ValidationError>) =>
  Effect.gen(function* () {
    const existing = yield* loadRow(id)
    const changes = yield* input

    const [row] = yield* writingInWorkspace(async (tx, workspaceId) => {
      await assertChannelsFit(tx, workspaceId, { ...existing, ...changes })

      return tx
        .update(flows)
        .set(changes)
        .where(inWorkspace(flows, workspaceId, byId(id)))
        .returning()
    })

    return yield* toFlow(row ?? (yield* new NotFound()))
  })

const moveInTransaction = async (
  tx: Transaction,
  workspaceId: string,
  id: string,
  { mappingVersionId }: MoveFlowMappingVersionBody,
) => {
  const [locked] = await tx
    .select({ mappingId: mappingVersions.mappingId, version: mappingVersions.version })
    .from(flows)
    .innerJoin(mappingVersions, eq(flows.mappingVersionId, mappingVersions.id))
    .where(inWorkspace(flows, workspaceId, byId(id)))
    .for('update', { of: flows })

  if (!locked) {
    return []
  }

  const [target] = await tx
    .select({ version: mappingVersions.version })
    .from(mappingVersions)
    .where(
      and(
        eq(mappingVersions.id, mappingVersionId),
        eq(mappingVersions.mappingId, locked.mappingId),
      ),
    )

  if (!target) {
    throw new Unprocessable({
      message: 'The Mapping Version does not belong to the Mapping of this Flow',
    })
  }

  if (target.version <= locked.version) {
    throw new Conflict({ message: 'A Flow only moves to a newer Mapping Version' })
  }

  return tx.update(flows).set({ mappingVersionId }).where(byId(id)).returning()
}

export const moveFlowMappingVersion = (
  id: string,
  input: Effect.Effect<MoveFlowMappingVersionBody, ValidationError>,
) =>
  Effect.gen(function* () {
    yield* loadRow(id)
    const body = yield* input

    const [row] = yield* writingInWorkspace((tx, workspaceId) =>
      moveInTransaction(tx, workspaceId, id, body),
    )

    return yield* toFlow(row ?? (yield* new NotFound()))
  })
