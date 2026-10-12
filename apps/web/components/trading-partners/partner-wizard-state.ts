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
  channelFields,
  type ChannelFieldErrors,
  type ChannelFormValues,
  type FieldError,
  toFormValues,
  validateNewChannel,
} from '../channels/channel-form-values'
import { defaultKindKey, type DetailedWay, wayKind } from './partner-connections'
import { chosenOrOnly } from './partner-documents'

export const wizardSteps = ['partner', 'documents', 'connections', 'mappings', 'review'] as const

export type WizardStep = (typeof wizardSteps)[number]

export const wizardDocuments = newMappingMessageTypes

export type WizardDocument = (typeof wizardDocuments)[number]

export const connectionWays = ['sftp', 'web', 'ask'] as const satisfies ReadonlyArray<
  DetailedWay | 'ask'
>

export type ConnectionWay = (typeof connectionWays)[number]

export type WizardConnection = { way: ConnectionWay; values: ChannelFormValues }

const partnerFields = ['name', 'tradingPartnerId'] as const satisfies ReadonlyArray<ChannelField>

export type ConnectionField = Exclude<ChannelField, (typeof partnerFields)[number]>

function isConnectionField(field: ChannelField): field is ConnectionField {
  return !partnerFields.some((partnerField) => partnerField === field)
}

export const connectionFields = channelFields.filter(isConnectionField)

export type WizardMapping =
  { way: 'existing'; mappingVersionId: string | null } | { way: 'ai' } | { way: 'later' }

export type MappingWay = WizardMapping['way']

export type MappingResult =
  { way: 'existing'; mappingVersionId: string } | { way: 'ai' } | { way: 'later' }

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
} & { [Key in `${WizardDocument}.${'mapping' | 'mappingVersion'}`]: 'required' }

export type WizardField = keyof WizardFieldErrors

export type WizardErrors = { [Field in WizardField]?: WizardFieldErrors[Field] }

export function wizardFieldId(baseId: string, field: WizardField | Direction) {
  return `${baseId}-${field.replace('.', '-')}`
}

export type ConnectionResult = { way: 'ask' } | { way: DetailedWay; values: ChannelFormValues }

export type WizardResult = Pick<PartnerWizardState, 'documents'> & {
  partner: Pick<TradingPartnerInput, 'name' | 'gln'>
  connections: Partial<Record<Direction, ConnectionResult>>
  mappings: Partial<Record<WizardDocument, MappingResult>>
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

export type OfferedMappings = Partial<Record<WizardDocument, ReadonlyArray<string>>>

function mappingError(
  mapping: WizardMapping | undefined,
  offered: ReadonlyArray<string>,
): 'mapping' | 'mappingVersion' | null {
  if (mapping === undefined) {
    return 'mapping'
  }

  if (mapping.way !== 'existing') {
    return null
  }

  const { mappingVersionId } = mapping

  if (mappingVersionId !== null && offered.includes(mappingVersionId)) {
    return null
  }

  return offered.length > 1 ? 'mappingVersion' : 'mapping'
}

function mappingsErrors(
  { documents, mappings }: PartnerWizardState,
  offeredMappings: OfferedMappings,
): WizardErrors {
  const errors: WizardErrors = {}

  for (const document of documents) {
    const field = mappingError(mappings[document], offeredMappings[document] ?? [])

    if (field !== null) {
      errors[`${document}.${field}`] = 'required'
    }
  }

  return errors
}

export function stepErrors(
  step: WizardStep,
  state: PartnerWizardState,
  offeredMappings: OfferedMappings = {},
): WizardErrors {
  switch (step) {
    case 'partner':
      return partnerErrors(state)
    case 'documents':
      return state.documents.length === 0 ? { documents: 'required' } : {}
    case 'connections':
      return connectionsErrors(state)
    case 'mappings':
      return mappingsErrors(state, offeredMappings)
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

function connectionResult({ way, values }: WizardConnection): ConnectionResult {
  return way === 'ask' ? { way } : { way, values }
}

function neededConnections({ documents, connections }: PartnerWizardState) {
  const needed: WizardResult['connections'] = {}

  for (const direction of neededDirections(documents)) {
    const connection = connections[direction]

    if (connection) {
      needed[direction] = connectionResult(connection)
    }
  }

  return needed
}

function mappingResult(mapping: WizardMapping): MappingResult | null {
  if (mapping.way !== 'existing') {
    return mapping
  }

  const { mappingVersionId } = mapping

  return mappingVersionId === null ? null : { way: mapping.way, mappingVersionId }
}

function chosenMappings({ documents, mappings }: PartnerWizardState) {
  const chosen: WizardResult['mappings'] = {}

  for (const document of documents) {
    const mapping = mappings[document]
    const result = mapping && mappingResult(mapping)

    if (result) {
      chosen[document] = result
    }
  }

  return chosen
}

export function wizardResult(state: PartnerWizardState): WizardResult {
  const { name, gln, glnLater } = state.partner

  return {
    documents: state.documents,
    partner: { name: name.trim(), gln: glnLater ? null : normalizeGln(gln) },
    connections: neededConnections(state),
    mappings: chosenMappings(state),
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

export function chooseMapping(
  mapping: WizardMapping | undefined,
  way: MappingWay,
  versionIds: ReadonlyArray<string>,
): WizardMapping {
  if (way !== 'existing') {
    return { way }
  }

  const kept = mapping?.way === 'existing' ? mapping.mappingVersionId : null

  return { way, mappingVersionId: chosenOrOnly(kept, versionIds) }
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
