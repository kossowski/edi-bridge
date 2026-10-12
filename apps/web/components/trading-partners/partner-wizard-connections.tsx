'use client'

import { useFormatter, useTranslations } from 'next-intl'
import { useId } from 'react'

import { ChannelKindFields, useChannelFields } from '@/components/channels/channel-form'
import { type ChannelFormValues } from '@/components/channels/channel-form-values'
import { CopyButton } from '@/components/copy-button'
import { ChoiceCards } from '@/components/trading-partners/choice-cards'
import { defaultKindKey, wayKind } from '@/components/trading-partners/partner-connections'
import {
  partnerRequest,
  travellingDocumentNames,
} from '@/components/trading-partners/partner-request'
import {
  channelFieldErrors,
  chooseWay,
  connectionWays,
  initialConnectionValues,
  neededDirections,
  type PartnerWizardState,
  type WizardConnection,
  type WizardErrors,
  wizardFieldId,
} from '@/components/trading-partners/partner-wizard-state'
import { type Direction } from '@edi-bridge/contracts'
import { Textarea } from '@edi-bridge/ui/components/textarea'

type UpdateConnection = (
  direction: Direction,
  update: (current: WizardConnection | undefined) => WizardConnection | undefined,
) => void

function DirectionConnection({
  direction,
  state,
  errors,
  idPrefix,
  onUpdate,
}: {
  direction: Direction
  state: PartnerWizardState
  errors: WizardErrors
  idPrefix: string
  onUpdate: UpdateConnection
}) {
  const t = useTranslations('PartnerWizard')
  const tHow = useTranslations('TradingPartner.addConnection.how')
  const format = useFormatter()
  const connection = state.connections[direction]
  const values = connection?.values ?? initialConnectionValues(direction)
  const name = state.partner.name.trim()

  function setValues(update: (current: ChannelFormValues) => ChannelFormValues) {
    onUpdate(direction, (current) => current && { ...current, values: update(current.values) })
  }

  const fields = useChannelFields(
    values,
    setValues,
    channelFieldErrors(errors, direction),
    wizardFieldId(idPrefix, direction),
  )

  const wayError = errors[`${direction}.way`]

  const documents = travellingDocumentNames(state.documents, direction, {
    t,
    list: (items) => format.list(items),
  })

  const items = connectionWays.map((way) => {
    if (way === 'ask') {
      return {
        value: way,
        title: t('connections.ask.title'),
        description: t('connections.ask.description'),
      }
    }

    const kind = wayKind(direction, way)

    return {
      value: way,
      title: tHow(`${kind}.title`, { name }),
      description: tHow(`${kind}.description`),
      badge: kind === defaultKindKey(direction) ? tHow('recommended') : undefined,
    }
  })

  const kind = connection && connection.way !== 'ask' ? wayKind(direction, connection.way) : null

  return (
    <div className="flex flex-col gap-4">
      <ChoiceCards
        id={wizardFieldId(idPrefix, `${direction}.way`)}
        error={wayError === undefined ? null : t('errors.way.required')}
        items={items}
        label={t(`connections.${direction}.label`, { name, documents })}
        value={connection?.way ?? null}
        onChange={(way) => onUpdate(direction, (current) => chooseWay(current, direction, way))}
      />
      {kind === 'webhook-inbound' && (
        <p className="text-muted-foreground text-sm">{t('connections.webhookNotice', { name })}</p>
      )}
      {connection && kind !== null && kind !== 'webhook-inbound' && (
        <ChannelKindFields fields={fields} values={connection.values} />
      )}
    </div>
  )
}

function PartnerRequest({ request, name }: { request: string; name: string }) {
  const t = useTranslations('PartnerWizard.connections.request')
  const id = useId()

  return (
    <section aria-labelledby={`${id}-title`} className="flex flex-col gap-3 rounded-lg border p-4">
      <h3 id={`${id}-title`} className="text-sm font-medium">
        {t('title', { name })}
      </h3>
      <p id={`${id}-description`} className="text-muted-foreground text-sm">
        {t('description')}
      </p>
      <Textarea
        readOnly
        rows={10}
        value={request}
        aria-describedby={`${id}-description`}
        aria-labelledby={`${id}-title`}
        className="text-sm"
      />
      <CopyButton label={t('copy')} value={request} />
    </section>
  )
}

export function ConnectionsStep({
  state,
  errors,
  idPrefix,
  onUpdate,
}: {
  state: PartnerWizardState
  errors: WizardErrors
  idPrefix: string
  onUpdate: UpdateConnection
}) {
  const t = useTranslations('PartnerWizard')
  const format = useFormatter()
  const request = partnerRequest(state, { t, list: (items) => format.list(items) })

  return (
    <div className="flex flex-col gap-8">
      {neededDirections(state.documents).map((direction) => (
        <DirectionConnection
          key={direction}
          direction={direction}
          errors={errors}
          idPrefix={idPrefix}
          state={state}
          onUpdate={onUpdate}
        />
      ))}
      {request !== null && <PartnerRequest name={state.partner.name.trim()} request={request} />}
    </div>
  )
}
