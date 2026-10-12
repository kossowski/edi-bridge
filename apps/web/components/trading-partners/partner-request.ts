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

export function partnerRequest(state: PartnerWizardState, { t, list }: RequestFormat) {
  const items = postponedDirections(state).map((direction) =>
    t(`request.${direction}`, {
      documents: list(
        documentsTravelling(state.documents, direction).map((messageType) =>
          t(`documentNames.${messageType}`),
        ),
      ),
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
