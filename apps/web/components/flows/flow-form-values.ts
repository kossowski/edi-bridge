import {
  type ChannelSummary,
  type Direction,
  type Flow,
  type FlowInput,
  flowInputSchema,
  type FlowUpdate,
  flowUpdateSchema,
  type MessageType,
} from '@edi-bridge/contracts'

import { fieldErrors, type FormIssue, tooLongOr } from '../../lib/forms/field-errors'

export type FlowFormValues = {
  name: string
  tradingPartnerId: string
  messageType: MessageType
  inboundChannelId: string
  destinationChannelId: string
  mappingVersionId: string
}

export type FlowField = keyof FlowFormValues

export type FlowFieldError = 'required' | 'tooLong'

export type FlowFormResult<Input> =
  { input: Input } | { errors: Partial<Record<FlowField, FlowFieldError>> }

const fields = [
  'name',
  'tradingPartnerId',
  'messageType',
  'inboundChannelId',
  'destinationChannelId',
  'mappingVersionId',
] as const satisfies ReadonlyArray<FlowField>

export function toFormValues(flow?: Flow): FlowFormValues {
  return {
    name: flow?.name ?? '',
    tradingPartnerId: flow?.tradingPartnerId ?? '',
    messageType: flow?.messageType ?? 'ORDERS',
    inboundChannelId: flow?.inboundChannelId ?? '',
    destinationChannelId: flow?.destinationChannelId ?? '',
    mappingVersionId: flow?.mappingVersion.id ?? '',
  }
}

// A Channel of the company's own systems serves every Trading Partner; any other Channel only
// its own one.
export function fitsTradingPartner(channel: ChannelSummary, tradingPartnerId: string) {
  return channel.tradingPartnerId === null || channel.tradingPartnerId === tradingPartnerId
}

export function channelChoices<Channel extends ChannelSummary>(
  channels: ReadonlyArray<Channel>,
  direction: Direction,
  tradingPartnerId: string,
): Channel[] {
  return channels
    .filter(
      (channel) => channel.direction === direction && fitsTradingPartner(channel, tradingPartnerId),
    )
    .sort((a, b) => a.name.localeCompare(b.name, 'de'))
}

export function chooseTradingPartner(
  values: FlowFormValues,
  tradingPartnerId: string,
  channels: ReadonlyArray<ChannelSummary>,
): FlowFormValues {
  const keepIfFits = (id: string) => {
    const channel = channels.find((candidate) => candidate.id === id)

    return channel && fitsTradingPartner(channel, tradingPartnerId) ? id : ''
  }

  return {
    ...values,
    tradingPartnerId,
    inboundChannelId: keepIfFits(values.inboundChannelId),
    destinationChannelId: keepIfFits(values.destinationChannelId),
  }
}

// A Mapping Version reads or writes one Message Type, so a new Message Type needs a new choice.
export function chooseMessageType(values: FlowFormValues, messageType: MessageType) {
  return messageType === values.messageType
    ? values
    : { ...values, messageType, mappingVersionId: '' }
}

function collectErrors(issues: ReadonlyArray<FormIssue>) {
  return fieldErrors(issues, fields, (_, issue): FlowFieldError => tooLongOr(issue, 'required'))
}

export function validateNewFlow(values: FlowFormValues): FlowFormResult<FlowInput> {
  const parsed = flowInputSchema.safeParse(values)

  return parsed.success ? { input: parsed.data } : { errors: collectErrors(parsed.error.issues) }
}

export function validateFlowUpdate(values: FlowFormValues): FlowFormResult<FlowUpdate> {
  const parsed = flowUpdateSchema.safeParse(values)

  return parsed.success ? { input: parsed.data } : { errors: collectErrors(parsed.error.issues) }
}
