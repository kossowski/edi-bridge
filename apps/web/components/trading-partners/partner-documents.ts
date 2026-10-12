import {
  type ChannelSummary,
  directionOf,
  fitsFlow,
  type FlowChannelField,
  type FlowInput,
  type FlowSummary,
  type MappingVersionSummary,
  maxFlowNameLength,
  type MessageType,
  messageTypes,
} from '@edi-bridge/contracts'

export const aiMappingChoice = 'ai'

export function partnerFlows<
  Item extends Pick<FlowSummary, 'tradingPartnerId' | 'messageType' | 'name'>,
>(flows: ReadonlyArray<Item>, tradingPartnerId: string): Item[] {
  return flows
    .filter((flow) => flow.tradingPartnerId === tradingPartnerId)
    .sort(
      (a, b) =>
        messageTypes.indexOf(a.messageType) - messageTypes.indexOf(b.messageType) ||
        a.name.localeCompare(b.name, 'de'),
    )
}

export function partnerSideField(messageType: MessageType): FlowChannelField {
  return directionOf({ messageType }) === 'inbound' ? 'inboundChannelId' : 'destinationChannelId'
}

export function ownSideField(messageType: MessageType): FlowChannelField {
  return directionOf({ messageType }) === 'inbound' ? 'destinationChannelId' : 'inboundChannelId'
}

type ConnectionChannel = Pick<ChannelSummary, 'name' | 'direction' | 'tradingPartnerId'>

function fittingConnections<Channel extends ConnectionChannel>(
  channels: ReadonlyArray<Channel>,
  field: FlowChannelField,
  flow: Pick<FlowSummary, 'messageType' | 'tradingPartnerId'>,
) {
  return channels
    .filter((channel) => fitsFlow(channel, field, flow))
    .sort((a, b) => a.name.localeCompare(b.name, 'de'))
}

export function documentConnections<Channel extends ConnectionChannel>(
  channels: ReadonlyArray<Channel>,
  messageType: MessageType,
  tradingPartnerId: string,
) {
  const flow = { messageType, tradingPartnerId }

  return {
    partner: fittingConnections(channels, partnerSideField(messageType), flow),
    own: fittingConnections(channels, ownSideField(messageType), flow),
  }
}

export function ownConnections<Channel extends ConnectionChannel>(
  channels: ReadonlyArray<Channel>,
  messageType: MessageType,
) {
  return fittingConnections(channels, ownSideField(messageType), {
    messageType,
    tradingPartnerId: '',
  })
}

export function latestMappingVersions(
  versions: ReadonlyArray<MappingVersionSummary>,
): MappingVersionSummary[] {
  return [...Map.groupBy(versions, (version) => version.mappingId).values()]
    .flatMap((group) => newestVersion(group) ?? [])
    .sort((a, b) => a.mappingName.localeCompare(b.mappingName, 'de'))
}

export function chosenOrOnly<Value>(
  chosen: Value | null,
  options: ReadonlyArray<Value>,
): Value | null {
  if (chosen !== null && options.includes(chosen)) {
    return chosen
  }

  return options.length === 1 ? (options[0] ?? null) : null
}

export function newDocumentFlow({
  name,
  tradingPartnerId,
  messageType,
  partnerChannelId,
  ownChannelId,
  mappingVersionId,
}: {
  name: string
  tradingPartnerId: string
  messageType: MessageType
  partnerChannelId: string
  ownChannelId: string
  mappingVersionId: string
}): FlowInput {
  const fromPartner = directionOf({ messageType }) === 'inbound'

  return {
    name: name.slice(0, maxFlowNameLength).trim(),
    tradingPartnerId,
    messageType,
    inboundChannelId: fromPartner ? partnerChannelId : ownChannelId,
    destinationChannelId: fromPartner ? ownChannelId : partnerChannelId,
    mappingVersionId,
  }
}

export function newestVersion(
  versions: ReadonlyArray<MappingVersionSummary>,
): MappingVersionSummary | null {
  return versions.reduce<MappingVersionSummary | null>(
    (newest, version) => (newest === null || version.version > newest.version ? version : newest),
    null,
  )
}
