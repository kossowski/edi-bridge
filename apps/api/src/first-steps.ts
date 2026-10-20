import { count, eq } from 'drizzle-orm'
import { Effect } from 'effect'

import { firstStepsOf } from '@edi-bridge/contracts'
import { channels, mappings, mappingVersions } from '@edi-bridge/db'

import { Db } from './db.js'
import { inWorkspace } from './rows.js'
import { listTradingPartners } from './trading-partner.js'
import { CurrentWorkspace, loadCurrentWorkspace } from './workspace.js'

export const loadFirstSteps = Effect.gen(function* () {
  const db = yield* Db
  const { id } = yield* CurrentWorkspace

  const [{ gln }, tradingPartners, [channelRows, [published]]] = yield* Effect.all([
    loadCurrentWorkspace,
    listTradingPartners,
    Effect.promise(() =>
      Promise.all([
        db
          .select({ tradingPartnerId: channels.tradingPartnerId })
          .from(channels)
          .where(inWorkspace(channels, id)),
        db
          .select({ count: count() })
          .from(mappingVersions)
          .innerJoin(mappings, eq(mappings.id, mappingVersions.mappingId))
          .where(inWorkspace(mappings, id)),
      ]),
    ),
  ])

  return firstStepsOf({
    gln,
    channels: channelRows,
    tradingPartners,
    publishedMappingVersions: published?.count ?? 0,
  })
})
