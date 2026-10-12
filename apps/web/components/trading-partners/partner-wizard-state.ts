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

export const wizardSteps = ['partner', 'documents', 'connections', 'mappings', 'review'] as const

export type WizardStep = (typeof wizardSteps)[number]

export const wizardDocuments = newMappingMessageTypes

export type WizardDocument = (typeof wizardDocuments)[number]

export const connectionWays = ['sftp', 'web', 'ask'] as const

export type ConnectionWay = (typeof connectionWays)[number]

export type WizardConnection = { way: ConnectionWay }

export type WizardMapping =
  { kind: 'existing'; mappingVersionId: string } | { kind: 'ai' } | { kind: 'later' }

export type PartnerWizardState = {
  partner: { name: string; gln: string; glnLater: boolean }
  documents: WizardDocument[]
  connections: Partial<Record<Direction, WizardConnection>>
  mappings: Partial<Record<WizardDocument, WizardMapping>>
}

export type WizardFieldErrors = {
  name: 'required' | 'tooLong'
  gln: GlnError
  documents: 'required'
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

export function stepErrors(step: WizardStep, state: PartnerWizardState): WizardErrors {
  switch (step) {
    case 'partner':
      return partnerErrors(state)
    case 'documents':
      return state.documents.length === 0 ? { documents: 'required' } : {}
    case 'connections':
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

export function wizardResult(state: PartnerWizardState): WizardResult {
  const { name, gln, glnLater } = state.partner

  return {
    ...state,
    partner: { name: name.trim(), gln: glnLater ? null : normalizeGln(gln) },
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
