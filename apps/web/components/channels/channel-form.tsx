'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { type FormEvent, useId, useRef, useState } from 'react'

import {
  type ChannelField,
  type ChannelFormValues,
  channelKindKeys,
  channelKindOf,
  type FieldError,
  type FieldOfKind,
  isChannelKindKey,
  isFieldOfKind,
  toFormValues,
  validateChannelUpdate,
  validateNewChannel,
} from '@/components/channels/channel-form-values'
import { useChannelKindLabel } from '@/components/channels/channel-parts'
import { Fieldset, SelectField, TextareaField, TextField } from '@/components/form-field'
import { ApiError, createChannel, updateChannel } from '@/lib/api/client'
import { storeSavedChannel, tradingPartnersQuery } from '@/lib/api/queries'
import {
  type Channel,
  type ChannelInput,
  type ChannelUpdate,
  type CreatedChannel,
  pollingIntervalMinutes,
  sftpAuthentications,
  sftpPort,
  webhookRateLimitPerMinute,
} from '@edi-bridge/contracts'
import { Button, buttonVariants } from '@edi-bridge/ui/components/button'
import { Checkbox } from '@edi-bridge/ui/components/checkbox'
import { RadioGroup, RadioGroupItem } from '@edi-bridge/ui/components/radio-group'

const ranges = {
  port: sftpPort,
  pollingIntervalMinutes,
  rateLimitPerMinute: webhookRateLimitPerMinute,
} as const satisfies Record<FieldOfKind<'number'>, { min: number; max: number }>

// Base UI's Select treats an empty string as "no value", so "own systems" needs a real one.
const ownSystems = 'own-systems'

function useFieldErrorMessage() {
  const t = useTranslations('ChannelForm.errors')

  return (field: ChannelField, error: FieldError) => {
    switch (error) {
      case 'tooLong':
        return t('tooLong')
      case 'range':
        return isFieldOfKind(field, 'number') ? t('range', ranges[field]) : t('invalid')
      case 'format':
        return isFieldOfKind(field, 'format') ? t(`format.${field}`) : t('invalid')
      case 'required':
        return isFieldOfKind(field, 'choice') ? t('invalid') : t(`required.${field}`)
    }
  }
}

type TextFieldName = Exclude<ChannelField, 'tradingPartnerId' | 'authentication'>

function KindChoice({
  value,
  onChange,
}: {
  value: ChannelFormValues['kind']
  onChange: (kind: ChannelFormValues['kind']) => void
}) {
  const t = useTranslations('ChannelForm.fields.kind')
  const tKind = useTranslations('ChannelKind')
  const id = useId()

  return (
    <div className="flex flex-col gap-1.5">
      <span id={`${id}-label`} className="text-sm font-medium">
        {t('label')}
      </span>
      <RadioGroup
        value={value}
        aria-describedby={`${id}-description`}
        aria-labelledby={`${id}-label`}
        className="grid gap-2 sm:grid-cols-2"
        onValueChange={(next) => {
          if (isChannelKindKey(next)) {
            onChange(next)
          }
        }}>
        {channelKindKeys.map((key) => (
          <label
            key={key}
            className="has-data-checked:border-primary has-data-checked:bg-muted/50 grid cursor-pointer grid-cols-[auto_1fr] items-start gap-x-3 gap-y-0.5 rounded-lg border p-3">
            <RadioGroupItem value={key} aria-describedby={`${id}-${key}`} className="mt-0.5" />
            <span className="text-sm font-medium">{tKind(`${key}.label`)}</span>
            <span id={`${id}-${key}`} className="text-muted-foreground col-start-2 text-sm">
              {tKind(`${key}.description`)}
            </span>
          </label>
        ))}
      </RadioGroup>
      <p id={`${id}-description`} className="text-muted-foreground text-sm">
        {t('description')}
      </p>
    </div>
  )
}

function FixedKind({ channel }: { channel: Channel }) {
  const t = useTranslations('ChannelForm.fields.kind')
  const kindLabel = useChannelKindLabel()

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">{t('label')}</span>
      <p className="text-sm">{kindLabel(channel)}</p>
      <p className="text-muted-foreground text-sm">{t('fixed')}</p>
    </div>
  )
}

type Submission = { create: ChannelInput } | { id: string; update: ChannelUpdate }

function toSubmission(
  values: ChannelFormValues,
  channel?: Channel,
): { submission: Submission } | { errors: Partial<Record<ChannelField, FieldError>> } {
  if (channel) {
    const result = validateChannelUpdate(values, channel)

    return 'input' in result ? { submission: { id: channel.id, update: result.input } } : result
  }

  const result = validateNewChannel(values)

  return 'input' in result ? { submission: { create: result.input } } : result
}

export function ChannelForm({
  channel,
  onCreated,
}: {
  channel?: Channel
  onCreated?: (created: CreatedChannel) => void
}) {
  const t = useTranslations('ChannelForm')
  const tAuthentication = useTranslations('Channel.authentication')
  const errorMessage = useFieldErrorMessage()
  const queryClient = useQueryClient()
  const router = useRouter()
  const baseId = useId()
  const formRef = useRef<HTMLFormElement>(null)
  const [values, setValues] = useState<ChannelFormValues>(() => toFormValues(channel))
  const [submitted, setSubmitted] = useState(false)
  const tradingPartners = useQuery(tradingPartnersQuery)

  const save = useMutation({
    mutationFn: async (submission: Submission): Promise<CreatedChannel> =>
      'create' in submission
        ? createChannel(submission.create)
        : { channel: await updateChannel(submission.id, submission.update), webhookToken: null },
    onSuccess: (saved) => {
      storeSavedChannel(queryClient, saved.channel)

      if (saved.webhookToken !== null && onCreated) {
        onCreated(saved)
      } else {
        router.push(`/channels/${saved.channel.id}`)
      }
    },
  })

  const result = toSubmission(values, channel)
  const errors = submitted && 'errors' in result ? result.errors : {}
  const kind = channelKindOf(values.kind)

  function messageFor(field: ChannelField) {
    const error = errors[field]

    return error ? errorMessage(field, error) : null
  }

  function update<Field extends keyof ChannelFormValues>(
    field: Field,
    value: ChannelFormValues[Field],
  ) {
    setValues((current) => ({ ...current, [field]: value }))
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitted(true)

    if ('errors' in result) {
      const first = Object.keys(result.errors)[0]
      formRef.current?.querySelector<HTMLElement>(`[name="${first}"]`)?.focus()

      return
    }

    save.mutate(result.submission)
  }

  function field(name: TextFieldName) {
    return {
      name,
      id: `${baseId}-${name}`,
      error: messageFor(name),
      value: values[name],
      onChange: (next: string) => update(name, next),
    }
  }

  const tradingPartnerItems = [
    { value: ownSystems, label: t('fields.tradingPartner.none') },
    ...(tradingPartners.data ?? []).map(({ id, name }) => ({ value: id, label: name })),
  ]

  const credential = field('credential')

  const credentialDescription = channel
    ? t('fields.credential.keep')
    : t('fields.credential.description')

  const authorization = field('authorization')
  const kindChanged = save.error instanceof ApiError && save.error.status === 409

  return (
    <form noValidate ref={formRef} className="flex max-w-2xl flex-col gap-6" onSubmit={submit}>
      {channel ? (
        <FixedKind channel={channel} />
      ) : (
        <KindChoice value={values.kind} onChange={(next) => update('kind', next)} />
      )}
      <TextField
        {...field('name')}
        autoComplete="off"
        description={t('fields.name.description')}
        label={t('fields.name.label')}
      />
      <SelectField
        id={`${baseId}-tradingPartnerId`}
        description={t('fields.tradingPartner.description')}
        items={tradingPartnerItems}
        label={t('fields.tradingPartner.label')}
        value={values.tradingPartnerId === '' ? ownSystems : values.tradingPartnerId}
        onChange={(next) => update('tradingPartnerId', next === ownSystems ? '' : next)}
      />
      {kind.type === 'sftp' && (
        <Fieldset legend={t('sections.sftp')}>
          <div className="grid gap-6 sm:grid-cols-[1fr_8rem]">
            <TextField
              {...field('host')}
              autoComplete="off"
              description={t('fields.host.description')}
              label={t('fields.host.label')}
              spellCheck={false}
              className="font-mono"
            />
            <TextField
              {...field('port')}
              description={t('fields.port.description')}
              inputMode="numeric"
              label={t('fields.port.label')}
              max={sftpPort.max}
              min={sftpPort.min}
              step={1}
              type="number"
            />
          </div>
          <TextField
            {...field('username')}
            autoComplete="off"
            description={t('fields.username.description')}
            label={t('fields.username.label')}
            spellCheck={false}
            className="font-mono sm:w-80"
          />
          <TextField
            {...field('remotePath')}
            autoComplete="off"
            description={t(`fields.remotePath.${kind.direction}`)}
            label={t('fields.remotePath.label')}
            spellCheck={false}
            className="font-mono"
          />
          {kind.direction === 'inbound' && (
            <TextField
              {...field('pollingIntervalMinutes')}
              description={t('fields.pollingIntervalMinutes.description')}
              inputMode="numeric"
              label={t('fields.pollingIntervalMinutes.label')}
              max={pollingIntervalMinutes.max}
              min={pollingIntervalMinutes.min}
              step={1}
              type="number"
              className="sm:w-32"
            />
          )}
          <SelectField
            id={`${baseId}-authentication`}
            description={t('fields.authentication.description')}
            items={sftpAuthentications.map((value) => ({ value, label: tAuthentication(value) }))}
            label={t('fields.authentication.label')}
            value={values.authentication}
            onChange={(next) => update('authentication', next)}
          />
          {values.authentication === 'privateKey' ? (
            <TextareaField
              {...credential}
              autoComplete="off"
              description={credentialDescription}
              label={tAuthentication('privateKey')}
              rows={6}
              spellCheck={false}
              className="min-h-32 font-mono text-xs"
            />
          ) : (
            <TextField
              {...credential}
              autoComplete="new-password"
              description={credentialDescription}
              label={tAuthentication('password')}
              type="password"
              className="sm:w-80"
            />
          )}
        </Fieldset>
      )}
      {kind.type === 'webhook' && (
        <Fieldset legend={t('sections.webhook')}>
          <TextField
            {...field('rateLimitPerMinute')}
            description={t('fields.rateLimitPerMinute.description')}
            inputMode="numeric"
            label={t('fields.rateLimitPerMinute.label')}
            max={webhookRateLimitPerMinute.max}
            min={webhookRateLimitPerMinute.min}
            step={1}
            type="number"
            className="sm:w-32"
          />
          {!channel && <p className="text-muted-foreground text-sm">{t('webhookNotice')}</p>}
        </Fieldset>
      )}
      {kind.type === 'http' && (
        <Fieldset legend={t('sections.http')}>
          <TextField
            {...field('url')}
            autoComplete="off"
            description={t('fields.url.description')}
            label={t('fields.url.label')}
            spellCheck={false}
            type="url"
            className="font-mono"
          />
          <label className="flex w-fit cursor-pointer items-center gap-2 text-sm font-medium">
            <Checkbox
              checked={values.sendAuthorization}
              onCheckedChange={(checked) => update('sendAuthorization', checked)}
            />
            {t('fields.sendAuthorization.label')}
          </label>
          {values.sendAuthorization && (
            <TextField
              {...authorization}
              autoComplete="new-password"
              description={
                channel?.type === 'http' && channel.authorization !== null
                  ? t('fields.authorization.keep')
                  : t('fields.authorization.description')
              }
              label={t('fields.authorization.label')}
              spellCheck={false}
              type="password"
              className="font-mono"
            />
          )}
        </Fieldset>
      )}
      {save.isError && (
        <p role="alert" className="text-sm text-red-800 dark:text-red-300">
          {kindChanged ? t('errors.kindChanged') : t('errors.saveFailed')}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button disabled={save.isPending} type="submit">
          {save.isPending ? t('saving') : channel ? t('save') : t('create')}
        </Button>
        <Link
          href={channel ? `/channels/${channel.id}` : '/channels'}
          className={buttonVariants({ variant: 'outline' })}>
          {t('cancel')}
        </Link>
      </div>
    </form>
  )
}
