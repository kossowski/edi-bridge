import type { FailedRun } from '@/components/documents/failed-run'
import type { ErrorPosition } from '@edi-bridge/contracts'

export type PartnerMessageKey =
  | 'greeting'
  | 'intro'
  | 'introWithoutReference'
  | 'transmission'
  | 'reason'
  | 'technical'
  | 'technicalAt'
  | 'segment'
  | 'element'
  | 'component'
  | 'request'
  | 'closing'

export type TranslatePartnerMessage = (
  key: PartnerMessageKey,
  values?: Record<string, string | number>,
) => string

function positionText(position: ErrorPosition, t: TranslatePartnerMessage) {
  return [
    t('segment', { segment: position.segment, tag: position.tag }),
    position.element !== null && t('element', { element: position.element }),
    position.component !== null && t('component', { component: position.component }),
  ]
    .filter(Boolean)
    .join(', ')
}

export function partnerMessage(
  run: FailedRun,
  { t, messageTypeName }: { t: TranslatePartnerMessage; messageTypeName: string },
) {
  const { error, interchange, businessReference: reference } = run
  const document = { messageTypeName, messageType: run.messageType }

  const intro = [
    reference === null
      ? t('introWithoutReference', document)
      : t('intro', { ...document, reference }),
    interchange && t('transmission', { controlReference: interchange.controlReference }),
  ]
    .filter(Boolean)
    .join(' ')

  const technical = error.position
    ? t('technicalAt', {
        message: error.message,
        code: error.code,
        position: positionText(error.position, t),
      })
    : t('technical', { message: error.message, code: error.code })

  return [
    t('greeting', { tradingPartner: run.tradingPartner.name }),
    intro,
    t('reason', { reason: run.problem.reason }),
    technical,
    t('request'),
    t('closing'),
  ].join('\n\n')
}
