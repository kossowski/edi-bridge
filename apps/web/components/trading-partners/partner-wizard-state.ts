import {
  type Direction,
  directionOf,
  directions,
  type MessageType,
  newMappingMessageTypes,
  tradingPartnerInputSchema,
} from '@edi-bridge/contracts'

import { type GlnError, glnError } from '../../lib/forms/gln'

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

export const wizardFields = ['name', 'gln', 'documents'] as const

export type WizardField = (typeof wizardFields)[number]

export type WizardErrors = {
  name?: 'required' | 'tooLong'
  gln?: GlnError
  documents?: 'required'
}

export const initialWizardState: PartnerWizardState = {
  partner: { name: '', gln: '', glnLater: false },
  documents: [],
  connections: {},
  mappings: {},
}

function partnerErrors({ partner }: PartnerWizardState): WizardErrors {
  const name = tradingPartnerInputSchema.shape.name.safeParse(partner.name)
  const gln = partner.glnLater ? null : glnError(partner.gln)
  const errors: WizardErrors = {}

  if (!name.success) {
    errors.name = name.error.issues.some((issue) => issue.code === 'too_big')
      ? 'tooLong'
      : 'required'
  }

  if (gln !== null) {
    errors.gln = gln
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
    case 'mappings':
    case 'review':
      return {}
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
