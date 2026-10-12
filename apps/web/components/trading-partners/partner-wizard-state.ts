import {
  type Direction,
  directionOf,
  directions,
  type MessageType,
  newMappingMessageTypes,
  type TradingPartnerInput,
  tradingPartnerInputSchema,
} from '@edi-bridge/contracts'

import { tooLongOr } from '../../lib/forms/field-errors'
import { type GlnError, glnError, normalizeGln } from '../../lib/forms/gln'
import {
  type ChannelField,
  type ChannelFieldErrors,
  type ChannelFormValues,
  type ChannelKindKey,
  type FieldError,
  toFormValues,
  validateNewChannel,
} from '../channels/channel-form-values'
import { defaultKindKey } from './partner-connections'

export const wizardSteps = ['partner', 'documents', 'connections', 'mappings', 'review'] as const

export type WizardStep = (typeof wizardSteps)[number]

export const wizardDocuments = newMappingMessageTypes

export type WizardDocument = (typeof wizardDocuments)[number]

export const connectionWays = ['sftp', 'web', 'ask'] as const

export type ConnectionWay = (typeof connectionWays)[number]

export type WizardConnection = { way: ConnectionWay; values: ChannelFormValues }

export const connectionFields = [
  'host',
  'port',
  'username',
  'remotePath',
  'pollingIntervalMinutes',
  'authentication',
  'credential',
  'rateLimitPerMinute',
  'url',
  'authorization',
] as const satisfies ReadonlyArray<ChannelField>

export type ConnectionField = (typeof connectionFields)[number]

export type WizardMapping =
  { kind: 'existing'; mappingVersionId: string } | { kind: 'ai' } | { kind: 'later' }

export type PartnerWizardState = {
  partner: { name: string; gln: string; glnLater: boolean }
  documents: WizardDocument[]
  connections: Partial<Record<Direction, WizardConnection>>
  mappings: Partial<Record<WizardDocument, WizardMapping>>
}

export type PartnerField = 'name' | 'gln' | 'documents'

export type WizardFieldErrors = {
  name: 'required' | 'tooLong'
  gln: GlnError
  documents: 'required'
} & { [Key in `${Direction}.way`]: 'required' } & {
  [Key in `${Direction}.${ConnectionField}`]: FieldError
}

export type WizardField = keyof WizardFieldErrors

export type WizardErrors = { [Field in WizardField]?: WizardFieldErrors[Field] }

export type WizardResult = Omit<PartnerWizardState, 'partner'> & {
  partner: Pick<TradingPartnerInput, 'name' | 'gln'>
}

export const initialWizardState: PartnerWizardState = {
  partner: { name: '', gln: '', glnLater: false },
  documents: [],
  connections: {},
  mappings: {},
}

function partnerErrors({ partner }: PartnerWizardState): WizardErrors {
  const name = tradingPartnerInputSchema.shape.name.safeParse(partner.name)
  const nameIssue = name.error?.issues[0]
  const gln = partner.glnLater ? null : glnError(partner.gln)

  return {
    ...(nameIssue && { name: tooLongOr(nameIssue, 'required' as const) }),
    ...(gln !== null && { gln }),
  }
}

function connectionErrors(
  direction: Direction,
  connection: WizardConnection | undefined,
): WizardErrors {
  const errors: WizardErrors = {}

  if (connection === undefined) {
    errors[`${direction}.way`] = 'required'

    return errors
  }

  if (connection.way === 'ask') {
    return errors
  }

  const result = validateNewChannel(connection.values)

  if ('errors' in result) {
    for (const field of connectionFields) {
      const error = result.errors[field]

      if (error !== undefined) {
        errors[`${direction}.${field}`] = error
      }
    }
  }

  return errors
}

function connectionsErrors({ documents, connections }: PartnerWizardState): WizardErrors {
  const errors: WizardErrors = {}

  for (const direction of neededDirections(documents)) {
    Object.assign(errors, connectionErrors(direction, connections[direction]))
  }

  return errors
}

export function stepErrors(step: WizardStep, state: PartnerWizardState): WizardErrors {
  switch (step) {
    case 'partner':
      return partnerErrors(state)
    case 'documents':
      return state.documents.length === 0 ? { documents: 'required' } : {}
    case 'connections':
      return connectionsErrors(state)
    case 'mappings':
    case 'review':
      return {}
  }
}

function isInvalidField(errors: WizardErrors, key: string): key is WizardField {
  return Object.entries(errors).some(([field, error]) => field === key && error !== undefined)
}

export function firstInvalidField(errors: WizardErrors): WizardField | undefined {
  return Object.keys(errors).find((key): key is WizardField => isInvalidField(errors, key))
}

export function channelFieldErrors(errors: WizardErrors, direction: Direction) {
  const channelErrors: ChannelFieldErrors = {}

  for (const field of connectionFields) {
    const error = errors[`${direction}.${field}`]

    if (error !== undefined) {
      channelErrors[field] = error
    }
  }

  return channelErrors
}

function neededConnections({ documents, connections }: PartnerWizardState) {
  const needed: PartnerWizardState['connections'] = {}

  for (const direction of neededDirections(documents)) {
    const connection = connections[direction]

    if (connection) {
      needed[direction] = connection
    }
  }

  return needed
}

export function wizardResult(state: PartnerWizardState): WizardResult {
  const { name, gln, glnLater } = state.partner

  return {
    ...state,
    partner: { name: name.trim(), gln: glnLater ? null : normalizeGln(gln) },
    connections: neededConnections(state),
  }
}

export function toggleDocument(
  documents: ReadonlyArray<WizardDocument>,
  document: WizardDocument,
  chosen: boolean,
): WizardDocument[] {
  return wizardDocuments.filter((candidate) =>
    candidate === document ? chosen : documents.includes(candidate),
  )
}

export function neededDirections(documents: ReadonlyArray<MessageType>): Direction[] {
  return directions.filter((direction) =>
    documents.some((messageType) => directionOf({ messageType }) === direction),
  )
}

export function documentsTravelling(
  documents: ReadonlyArray<WizardDocument>,
  direction: Direction,
): WizardDocument[] {
  return documents.filter((messageType) => directionOf({ messageType }) === direction)
}

export function postponedDirections({ documents, connections }: PartnerWizardState): Direction[] {
  return neededDirections(documents).filter((direction) => connections[direction]?.way === 'ask')
}

const connectionKinds = {
  inbound: { sftp: 'sftp-inbound', web: 'webhook-inbound' },
  outbound: { sftp: 'sftp-outbound', web: 'http-outbound' },
} as const satisfies {
  [Way in Direction]: Record<DetailedWay, Extract<ChannelKindKey, `${string}-${Way}`>>
}

export type DetailedWay = Exclude<ConnectionWay, 'ask'>

export function wayKind(direction: Direction, way: DetailedWay): ChannelKindKey {
  return connectionKinds[direction][way]
}

export function initialConnectionValues(direction: Direction): ChannelFormValues {
  return { ...toFormValues(), kind: defaultKindKey(direction), sendAuthorization: false }
}

export function chooseWay(
  connection: WizardConnection | undefined,
  direction: Direction,
  way: ConnectionWay,
): WizardConnection {
  const values = connection?.values ?? initialConnectionValues(direction)

  return {
    way,
    values: way === 'ask' ? values : { ...values, kind: wayKind(direction, way) },
  }
}
