import {
  acknowledgementTimeLimitHours,
  type Channel,
  type ChannelInput,
  type CreatedChannel,
  type CreateMappingBody,
  type Direction,
  directionOf,
  type Flow,
  type FlowInput,
  type MappingSummary,
  type TradingPartner,
  type TradingPartnerInput,
} from '@edi-bridge/contracts'

import { validateNewChannel } from '../channels/channel-form-values'
import { newDocumentFlow } from './partner-documents'
import {
  type LeftReason,
  type PlanChannel,
  type PlannedConnection,
  type PlannedRoute,
  type SetupPlan,
  type SkippedMappingDrafts,
} from './partner-setup-plan'
import { type WizardDocument } from './partner-wizard-state'
import { defaultCharacterSet } from './trading-partner-form-values'

export type FinishApi = {
  createTradingPartner: (input: TradingPartnerInput) => Promise<TradingPartner>
  createChannel: (input: ChannelInput) => Promise<CreatedChannel>
  createMapping: (body: CreateMappingBody) => Promise<MappingSummary>
  createFlow: (input: FlowInput) => Promise<Flow>
}

export type FinishedSetup = {
  tradingPartner: TradingPartner
  channels: Partial<Record<Direction, CreatedChannel>>
  mappings: Partial<Record<WizardDocument, MappingSummary>>
  flows: Partial<Record<WizardDocument, Flow>>
}

export type LeftRoute = Pick<PlannedRoute<PlanChannel>, 'name'> & { messageType: WizardDocument }

export type LeftConnection = Pick<PlannedConnection, 'direction' | 'kind'> & {
  name: string
  reason: 'invalid' | 'failed'
}

export type LeftOver = {
  connections: LeftConnection[]
  mappingDrafts: WizardDocument[]
  routes: LeftRoute[]
}

export function partnerInput(plan: Pick<SetupPlan<PlanChannel>, 'partner'>): TradingPartnerInput {
  return {
    ...plan.partner,
    characterSet: defaultCharacterSet,
    acknowledgementTimeLimitHours: acknowledgementTimeLimitHours.default,
  }
}

export function connectionInput(
  connection: PlannedConnection,
  tradingPartnerId: string,
): ChannelInput | null {
  const result = validateNewChannel({ ...connection.values, tradingPartnerId })

  return 'input' in result ? result.input : null
}

export function routeInput({
  messageType,
  route,
  tradingPartnerId,
  partnerChannelId,
}: {
  messageType: WizardDocument
  route: PlannedRoute<PlanChannel>
  tradingPartnerId: string
  partnerChannelId: string
}): FlowInput {
  return newDocumentFlow({
    name: route.name,
    tradingPartnerId,
    messageType,
    partnerChannelId,
    ownChannelId: route.ownChannel.id,
    mappingVersionId: route.mappingVersion.id,
  })
}

async function tryCreate<Result>(request: () => Promise<Result>): Promise<Result | undefined> {
  try {
    return await request()
  } catch {
    return undefined
  }
}

export async function finishSetup(
  plan: SetupPlan<PlanChannel>,
  api: FinishApi,
): Promise<FinishedSetup> {
  const tradingPartner = await api.createTradingPartner(partnerInput(plan))
  const finished: FinishedSetup = { tradingPartner, channels: {}, mappings: {}, flows: {} }

  for (const connection of plan.connections) {
    const input = connectionInput(connection, tradingPartner.id)
    const created = input && (await tryCreate(() => api.createChannel(input)))

    if (created) {
      finished.channels[connection.direction] = created
    }
  }

  for (const { messageType, documentStructureId } of plan.mappingDrafts) {
    const created = await tryCreate(() => api.createMapping({ messageType, documentStructureId }))

    if (created) {
      finished.mappings[messageType] = created
    }
  }

  for (const document of plan.documents) {
    if (!('route' in document)) {
      continue
    }

    const { route, messageType } = document
    const partnerChannel = finished.channels[route.partnerConnection.direction]

    const created =
      partnerChannel &&
      (await tryCreate(() =>
        api.createFlow(
          routeInput({
            messageType,
            route,
            tradingPartnerId: tradingPartner.id,
            partnerChannelId: partnerChannel.channel.id,
          }),
        ),
      ))

    if (created) {
      finished.flows[messageType] = created
    }
  }

  return finished
}

export function leftOver(plan: SetupPlan<PlanChannel>, finished: FinishedSetup): LeftOver {
  return {
    connections: plan.connections.flatMap((connection) => {
      const { direction, kind, values } = connection

      if (finished.channels[direction]) {
        return []
      }

      const valid = connectionInput(connection, finished.tradingPartner.id) !== null

      return [{ direction, kind, name: values.name, reason: valid ? 'failed' : 'invalid' }]
    }),
    mappingDrafts: plan.mappingDrafts.flatMap(({ messageType }) =>
      finished.mappings[messageType] ? [] : [messageType],
    ),
    routes: plan.documents.flatMap((document) =>
      'route' in document && !finished.flows[document.messageType]
        ? [{ messageType: document.messageType, name: document.route.name }]
        : [],
    ),
  }
}

export function nothingLeft({ connections, mappingDrafts, routes }: LeftOver) {
  return connections.length + mappingDrafts.length + routes.length === 0
}

export type LaterDocument = { messageType: WizardDocument; reasons: LeftReason[] }

export type ForLater = {
  connections: Direction[]
  documents: LaterDocument[]
}

export function forLater({ documents }: Pick<SetupPlan<PlanChannel>, 'documents'>): ForLater {
  const later = documents.flatMap((document) => ('reasons' in document ? [document] : []))

  return {
    connections: [
      ...new Set(
        later.flatMap(({ messageType, reasons }) =>
          reasons.includes('connectionPostponed') ? [directionOf({ messageType })] : [],
        ),
      ),
    ],
    documents: later.map(({ messageType, reasons }) => ({ messageType, reasons })),
  }
}

export function nothingForLater({ connections, documents }: ForLater) {
  return connections.length + documents.length === 0
}

export type CreatedWebhook = { channel: Extract<Channel, { type: 'webhook' }>; token: string }

export type SetupSummary = {
  name: string
  webhook: CreatedWebhook | null
  mappingDrafts: Array<{ messageType: WizardDocument; mapping: MappingSummary }>
  skippedMappingDrafts: SkippedMappingDrafts | null
  left: LeftOver
  later: ForLater
}

function createdWebhook({ channels }: FinishedSetup): CreatedWebhook | null {
  for (const { channel, webhookToken } of Object.values(channels)) {
    if (channel.type === 'webhook' && webhookToken !== null) {
      return { channel, token: webhookToken }
    }
  }

  return null
}

export function setupSummary(plan: SetupPlan<PlanChannel>, finished: FinishedSetup): SetupSummary {
  return {
    name: finished.tradingPartner.name,
    webhook: createdWebhook(finished),
    mappingDrafts: plan.mappingDrafts.flatMap(({ messageType }) => {
      const mapping = finished.mappings[messageType]

      return mapping ? [{ messageType, mapping }] : []
    }),
    skippedMappingDrafts: plan.skippedMappingDrafts,
    left: leftOver(plan, finished),
    later: forLater(plan),
  }
}
