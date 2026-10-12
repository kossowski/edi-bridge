import { type Direction } from '@edi-bridge/contracts'

import {
  documentsTravelling,
  type PartnerWizardState,
  postponedDirections,
  type WizardDocument,
} from './partner-wizard-state'

type RequestKey =
  | 'request.greeting'
  | 'request.intro'
  | 'request.inbound'
  | 'request.outbound'
  | 'request.gln'
  | 'request.closing'
  | `documentNames.${WizardDocument}`

export type RequestFormat = {
  t: (key: RequestKey, values?: { documents: string }) => string
  list: (items: ReadonlyArray<string>) => string
}

export type DocumentNamesFormat = {
  t: (key: `documentNames.${WizardDocument}`) => string
  list: RequestFormat['list']
}

export function travellingDocumentNames(
  documents: ReadonlyArray<WizardDocument>,
  direction: Direction,
  { t, list }: DocumentNamesFormat,
) {
  return list(
    documentsTravelling(documents, direction).map((messageType) =>
      t(`documentNames.${messageType}`),
    ),
  )
}

export function partnerRequest(state: PartnerWizardState, format: RequestFormat) {
  const { t } = format

  const items = postponedDirections(state).map((direction) =>
    t(`request.${direction}`, {
      documents: travellingDocumentNames(state.documents, direction, format),
    }),
  )

  if (state.partner.glnLater) {
    items.push(t('request.gln'))
  }

  if (items.length === 0) {
    return null
  }

  return [
    t('request.greeting'),
    '',
    t('request.intro'),
    '',
    ...items.map((item) => `- ${item}`),
    '',
    t('request.closing'),
  ].join('\n')
}
