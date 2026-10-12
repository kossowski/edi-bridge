import {
  acknowledgementTimeLimitHours,
  type Channel,
  type ChannelInput,
  type CreatedChannel,
  type CreateMappingBody,
  type Direction,
  type Flow,
  type FlowInput,
  type MappingSummary,
  type TradingPartner,
  type TradingPartnerInput,
} from '@edi-bridge/contracts'

import { validateNewChannel } from '../channels/channel-form-values'
import { newDocumentFlow } from './partner-documents'
import {
  type PlanChannel,
  type PlannedConnection,
  type PlannedRoute,
  type SetupPlan,
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

export type LeftOver = {
  connections: Array<Pick<PlannedConnection, 'direction' | 'kind'> & { name: string }>
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

export function routeInput(
  messageType: WizardDocument,
  route: PlannedRoute<PlanChannel>,
  tradingPartnerId: string,
  partnerChannelId: string,
): FlowInput {
  return newDocumentFlow({
    name: route.name,
    tradingPartnerId,
    messageType,
    partnerChannelId,
    ownChannelId: route.ownChannel.id,
    mappingVersionId: route.mappingVersion.id,
  })
}

async function attempt<Result>(request: () => Promise<Result>): Promise<Result | undefined> {
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
    const created = input && (await attempt(() => api.createChannel(input)))

    if (created) {
      finished.channels[connection.direction] = created
    }
  }

  for (const messageType of plan.mappingDrafts) {
    const created = await attempt(() => api.createMapping({ messageType }))

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
      (await attempt(() =>
        api.createFlow(
          routeInput(messageType, route, tradingPartner.id, partnerChannel.channel.id),
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
    connections: plan.connections.flatMap(({ direction, kind, values }) =>
      finished.channels[direction] ? [] : [{ direction, kind, name: values.name }],
    ),
    mappingDrafts: plan.mappingDrafts.filter((messageType) => !finished.mappings[messageType]),
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

export type CreatedWebhook = { channel: Extract<Channel, { type: 'webhook' }>; token: string }

export type SetupSummary = {
  name: string
  webhook: CreatedWebhook | null
  mappingDrafts: Array<{ messageType: WizardDocument; mapping: MappingSummary }>
  left: LeftOver
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
    mappingDrafts: plan.mappingDrafts.flatMap((messageType) => {
      const mapping = finished.mappings[messageType]

      return mapping ? [{ messageType, mapping }] : []
    }),
    left: leftOver(plan, finished),
  }
}
