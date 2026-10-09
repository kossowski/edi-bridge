'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { type FormEvent, useId, useRef, useState } from 'react'

import { useChannelKindLabel } from '@/components/channels/channel-parts'
import {
  channelChoices,
  chooseMessageType,
  chooseTradingPartner,
  type FlowField,
  type FlowFieldError,
  type FlowFormValues,
  toFormValues,
  validateFlowUpdate,
  validateNewFlow,
} from '@/components/flows/flow-form-values'
import { useMappingVersionLabel } from '@/components/flows/flow-parts'
import { Fieldset, SelectField, TextField } from '@/components/form-field'
import { ApiError, createFlow, updateFlow } from '@/lib/api/client'
import {
  channelsQuery,
  publishedMappingVersionsQuery,
  storeSavedFlow,
  tradingPartnersQuery,
} from '@/lib/api/queries'
import {
  type Flow,
  type FlowChannelField,
  type FlowInput,
  type FlowUpdate,
  messageTypes,
} from '@edi-bridge/contracts'
import { Button, buttonVariants } from '@edi-bridge/ui/components/button'

const channelKeys = {
  inboundChannelId: 'inboundChannel',
  destinationChannelId: 'destinationChannel',
} as const satisfies Record<FlowChannelField, string>

type Submission = { create: FlowInput } | { id: string; update: FlowUpdate }

function toSubmission(
  values: FlowFormValues,
  flow?: Flow,
): { submission: Submission } | { errors: Partial<Record<FlowField, FlowFieldError>> } {
  if (flow) {
    const result = validateFlowUpdate(values)

    return 'input' in result ? { submission: { id: flow.id, update: result.input } } : result
  }

  const result = validateNewFlow(values)

  return 'input' in result ? { submission: { create: result.input } } : result
}

function FixedValue({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      <p className="text-sm">{value}</p>
      <p className="text-muted-foreground text-sm">{note}</p>
    </div>
  )
}

function useChannelItems(values: FlowFormValues) {
  const channels = useQuery(channelsQuery)
  const kindLabel = useChannelKindLabel()

  return {
    all: channels.data ?? [],
    isPending: channels.isPending,
    items: (field: FlowChannelField) =>
      channelChoices(channels.data ?? [], field, values).map((channel) => ({
        value: channel.id,
        label: `${channel.name} · ${kindLabel(channel)}`,
      })),
  }
}

function MappingVersionChoice({
  id,
  values,
  error,
  onChange,
}: {
  id: string
  values: FlowFormValues
  error: string | null
  onChange: (mappingVersionId: string) => void
}) {
  const t = useTranslations('FlowForm.fields.mappingVersion')
  const versionLabel = useMappingVersionLabel()
  const versions = useQuery(publishedMappingVersionsQuery(values.messageType))

  const items = (versions.data ?? []).map((version) => ({
    value: version.id,
    label: versionLabel(version),
  }))

  const placeholder = versions.isPending
    ? t('loading')
    : versions.isError
      ? t('failed')
      : items.length === 0
        ? t('none', { messageType: values.messageType })
        : t('placeholder')

  return (
    <SelectField
      id={id}
      description={t('description')}
      disabled={items.length === 0}
      error={error}
      items={items}
      label={t('label')}
      placeholder={placeholder}
      value={values.mappingVersionId === '' ? null : values.mappingVersionId}
      onChange={onChange}
    />
  )
}

export function FlowForm({ flow }: { flow?: Flow }) {
  const t = useTranslations('FlowForm')
  const versionLabel = useMappingVersionLabel()
  const queryClient = useQueryClient()
  const router = useRouter()
  const baseId = useId()
  const formRef = useRef<HTMLFormElement>(null)
  const [values, setValues] = useState<FlowFormValues>(() => toFormValues(flow))
  const [submitted, setSubmitted] = useState(false)
  const tradingPartners = useQuery(tradingPartnersQuery)
  const channels = useChannelItems(values)

  const save = useMutation({
    mutationFn: (submission: Submission) =>
      'create' in submission
        ? createFlow(submission.create)
        : updateFlow(submission.id, submission.update),
    onSuccess: (saved) => {
      storeSavedFlow(queryClient, saved)
      router.push(`/flows/${saved.id}`)
    },
  })

  const result = toSubmission(values, flow)
  const errors = submitted && 'errors' in result ? result.errors : {}

  function messageFor(field: FlowField) {
    const error = errors[field]

    return error === undefined
      ? null
      : error === 'tooLong'
        ? t('errors.tooLong')
        : t(`errors.required.${field}`)
  }

  function idOf(field: FlowField) {
    return `${baseId}-${field}`
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitted(true)

    if ('errors' in result) {
      const first = Object.keys(result.errors)[0]
      formRef.current?.querySelector<HTMLElement>(`[id="${baseId}-${first}"]`)?.focus()

      return
    }

    save.mutate(result.submission)
  }

  function channelField(field: FlowChannelField) {
    const key = channelKeys[field]
    const items = channels.items(field)
    const empty = !channels.isPending && items.length === 0

    return (
      <SelectField
        id={idOf(field)}
        description={empty ? t(`fields.${key}.none`) : t(`fields.${key}.description`)}
        disabled={items.length === 0}
        error={messageFor(field)}
        items={items}
        label={t(`fields.${key}.label`)}
        placeholder={
          channels.isPending ? t('fields.channelsLoading') : t(`fields.${key}.placeholder`)
        }
        value={values[field] === '' ? null : values[field]}
        onChange={(next) => setValues((current) => ({ ...current, [field]: next }))}
      />
    )
  }

  const tradingPartnerName =
    tradingPartners.data?.find(({ id }) => id === values.tradingPartnerId)?.name ?? ''

  const invalidReference = save.error instanceof ApiError && save.error.status === 422

  return (
    <form noValidate ref={formRef} className="flex max-w-2xl flex-col gap-6" onSubmit={submit}>
      <TextField
        id={idOf('name')}
        autoComplete="off"
        description={t('fields.name.description')}
        error={messageFor('name')}
        label={t('fields.name.label')}
        name="name"
        value={values.name}
        onChange={(name) => setValues((current) => ({ ...current, name }))}
      />
      {flow ? (
        <>
          <FixedValue
            label={t('fields.tradingPartner.label')}
            note={t('fields.tradingPartner.fixed')}
            value={tradingPartnerName}
          />
          <FixedValue
            label={t('fields.messageType.label')}
            note={t('fields.messageType.fixed')}
            value={flow.messageType}
          />
        </>
      ) : (
        <>
          <SelectField
            id={idOf('tradingPartnerId')}
            description={t('fields.tradingPartner.description')}
            error={messageFor('tradingPartnerId')}
            items={(tradingPartners.data ?? []).map(({ id, name }) => ({ value: id, label: name }))}
            label={t('fields.tradingPartner.label')}
            placeholder={t('fields.tradingPartner.placeholder')}
            value={values.tradingPartnerId === '' ? null : values.tradingPartnerId}
            onChange={(next) =>
              setValues((current) => chooseTradingPartner(current, next, channels.all))
            }
          />
          <SelectField
            id={idOf('messageType')}
            description={t('fields.messageType.description')}
            items={messageTypes.map((messageType) => ({ value: messageType, label: messageType }))}
            label={t('fields.messageType.label')}
            value={values.messageType}
            onChange={(next) =>
              setValues((current) => chooseMessageType(current, next, channels.all))
            }
          />
        </>
      )}
      <Fieldset legend={t('sections.channels')}>
        {channelField('inboundChannelId')}
        {channelField('destinationChannelId')}
      </Fieldset>
      <Fieldset legend={t('sections.mappingVersion')}>
        {flow ? (
          <FixedValue
            label={t('fields.mappingVersion.label')}
            note={t('fields.mappingVersion.fixed')}
            value={versionLabel(flow.mappingVersion)}
          />
        ) : (
          <MappingVersionChoice
            id={idOf('mappingVersionId')}
            error={messageFor('mappingVersionId')}
            values={values}
            onChange={(mappingVersionId) =>
              setValues((current) => ({ ...current, mappingVersionId }))
            }
          />
        )}
      </Fieldset>
      {save.isError && (
        <p role="alert" className="text-sm text-red-800 dark:text-red-300">
          {invalidReference ? t('errors.invalidReference') : t('errors.saveFailed')}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button disabled={save.isPending} type="submit">
          {save.isPending ? t('saving') : flow ? t('save') : t('create')}
        </Button>
        <Link
          href={flow ? `/flows/${flow.id}` : '/flows'}
          className={buttonVariants({ variant: 'outline' })}>
          {t('cancel')}
        </Link>
      </div>
    </form>
  )
}
