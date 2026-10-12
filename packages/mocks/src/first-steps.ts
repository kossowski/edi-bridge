import { delay, http, HttpResponse } from 'msw'

import {
  firstStepsEndpoint,
  firstStepsOf,
  firstStepsSchema,
  type Session,
  type TradingPartner,
  type Workspace,
} from '@edi-bridge/contracts'

import { type ChannelRecord, type ChannelStore, seedChannels, toChannelStore } from './channel'
import {
  type MappingVersionRecord,
  type MappingVersionStore,
  seedMappingVersions,
  toMappingVersionStore,
} from './mapping-version'
import { serverError } from './responses'
import { type SessionStore, sessionStoreOf, signedInOnly } from './session-access'
import {
  seedTradingPartners,
  type TradingPartnerStore,
  toTradingPartnerStore,
} from './trading-partner'
import { seedWorkspace, toWorkspaceStore, type WorkspaceStore } from './workspace'

export type FirstStepsWorld = {
  workspace: Workspace | WorkspaceStore
  channels: ReadonlyArray<ChannelRecord> | ChannelStore
  tradingPartners: ReadonlyArray<TradingPartner> | TradingPartnerStore
  mappingVersions: ReadonlyArray<MappingVersionRecord> | MappingVersionStore
}

export type FirstStepsState = 'fresh' | 'partlyDone' | 'loading' | 'error'

export const freshFirstSteps: FirstStepsWorld = {
  workspace: { ...seedWorkspace, gln: null },
  channels: [],
  tradingPartners: [],
  mappingVersions: [],
}

const notTestedYet = seedTradingPartners.filter(
  ({ testMode, onboarding }) => testMode && onboarding.testInterchangeSentAt === null,
)

export const partlyDoneFirstSteps: FirstStepsWorld = {
  workspace: seedWorkspace,
  channels: seedChannels.filter(({ tradingPartnerId }) => tradingPartnerId === null),
  tradingPartners: notTestedYet,
  mappingVersions: [],
}

function worldOf(source: FirstStepsWorld | 'fresh' | 'partlyDone' | undefined) {
  switch (source) {
    case undefined:
      return {
        workspace: seedWorkspace,
        channels: seedChannels,
        tradingPartners: seedTradingPartners,
        mappingVersions: seedMappingVersions,
      }
    case 'fresh':
      return freshFirstSteps
    case 'partlyDone':
      return partlyDoneFirstSteps
    default:
      return source
  }
}

export function firstStepsHandler(
  apiUrl: string,
  source?: FirstStepsWorld | FirstStepsState,
  session?: Session | null | SessionStore,
) {
  const path = `${apiUrl}${firstStepsEndpoint.path}`

  if (source === 'loading') {
    return http.get(path, async () => {
      await delay('infinite')
    })
  }

  if (source === 'error') {
    return http.get(path, () => serverError())
  }

  const world = worldOf(source)
  const workspace = toWorkspaceStore(world.workspace)
  const channels = toChannelStore(world.channels)
  const tradingPartners = toTradingPartnerStore(world.tradingPartners)
  const mappingVersions = toMappingVersionStore(world.mappingVersions)

  const respond = () =>
    HttpResponse.json(
      firstStepsSchema.parse(
        firstStepsOf({
          gln: workspace.get().gln,
          channels: channels.all(),
          tradingPartners: tradingPartners.all(),
          publishedMappingVersions: mappingVersions.all().length,
        }),
      ),
    )

  return http.get(
    path,
    session === undefined ? respond : signedInOnly(sessionStoreOf(session), respond),
  )
}
