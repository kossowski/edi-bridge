import {
  type ChannelSummary,
  fitsFlow,
  type Flow,
  type FlowChannelField,
  flowChannelFields,
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

export function channelChoices<Channel extends ChannelSummary>(
  channels: ReadonlyArray<Channel>,
  field: FlowChannelField,
  values: Pick<FlowFormValues, 'messageType' | 'tradingPartnerId'>,
): Channel[] {
  return channels
    .filter((channel) => fitsFlow(channel, field, values))
    .sort((a, b) => a.name.localeCompare(b.name, 'de'))
}

function keepFittingChannels(
  values: FlowFormValues,
  channels: ReadonlyArray<ChannelSummary>,
): FlowFormValues {
  const kept = { ...values }

  for (const field of flowChannelFields) {
    const channel = channels.find((candidate) => candidate.id === values[field])

    if (!channel || !fitsFlow(channel, field, values)) {
      kept[field] = ''
    }
  }

  return kept
}

export function chooseTradingPartner(
  values: FlowFormValues,
  tradingPartnerId: string,
  channels: ReadonlyArray<ChannelSummary>,
): FlowFormValues {
  return keepFittingChannels({ ...values, tradingPartnerId }, channels)
}

// A Mapping Version reads or writes one Message Type, so a new Message Type needs a new choice.
export function chooseMessageType(
  values: FlowFormValues,
  messageType: MessageType,
  channels: ReadonlyArray<ChannelSummary>,
): FlowFormValues {
  return messageType === values.messageType
    ? values
    : keepFittingChannels({ ...values, messageType, mappingVersionId: '' }, channels)
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
