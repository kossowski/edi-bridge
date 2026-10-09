'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { type FormEvent, type ReactNode, useId, useRef, useState } from 'react'

import type { ComponentProps } from 'react'

import {
  type ChannelField,
  type ChannelFormValues,
  channelKindKeys,
  channelKindOf,
  type FieldError,
  isChannelKindKey,
  toFormValues,
  validateChannelUpdate,
  validateNewChannel,
} from '@/components/channels/channel-form-values'
import { useChannelKindLabel } from '@/components/channels/channel-parts'
import { describedBy, FormField } from '@/components/form-field'
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
import { Input } from '@edi-bridge/ui/components/input'
import { RadioGroup, RadioGroupItem } from '@edi-bridge/ui/components/radio-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@edi-bridge/ui/components/select'
import { Textarea } from '@edi-bridge/ui/components/textarea'

const ranges = {
  port: sftpPort,
  pollingIntervalMinutes,
  rateLimitPerMinute: webhookRateLimitPerMinute,
} as const

// Base UI's Select treats an empty string as "no value", so "own systems" needs a real one.
const ownSystems = 'own-systems'

function useFieldErrorMessage() {
  const t = useTranslations('ChannelForm.errors')

  return (field: ChannelField, error: FieldError) => {
    switch (error) {
      case 'tooLong':
        return t('tooLong')
      case 'range':
        return field === 'port' ||
          field === 'pollingIntervalMinutes' ||
          field === 'rateLimitPerMinute'
          ? t('range', ranges[field])
          : t('invalid')
      case 'format':
        return field === 'host' || field === 'remotePath' || field === 'url'
          ? t(`format.${field}`)
          : t('invalid')
      case 'required':
        return field === 'tradingPartnerId' || field === 'authentication'
          ? t('invalid')
          : t(`required.${field}`)
    }
  }
}

type TextFieldName = Exclude<ChannelField, 'tradingPartnerId' | 'authentication'>

type FieldProps = {
  field: ChannelField
  label: string
  description: string
  error: string | null
  id: string
  value: string
  onChange: (value: string) => void
} & Omit<ComponentProps<'input'>, 'id' | 'value' | 'onChange'>

function TextField({
  field,
  label,
  description,
  error,
  id,
  value,
  onChange,
  ...inputProps
}: FieldProps) {
  return (
    <FormField
      id={id}
      description={description}
      error={error}
      label={
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
      }>
      <Input
        id={id}
        name={field}
        value={value}
        aria-describedby={describedBy(id, error)}
        aria-invalid={error !== null}
        onChange={(event) => onChange(event.target.value)}
        {...inputProps}
      />
    </FormField>
  )
}

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

function SelectField<Value extends string>({
  id,
  label,
  description,
  value,
  items,
  onChange,
}: {
  id: string
  label: string
  description: string
  value: Value
  items: ReadonlyArray<{ value: Value; label: string }>
  onChange: (value: Value) => void
}) {
  return (
    <FormField
      id={id}
      description={description}
      error={null}
      label={
        <span id={`${id}-label`} className="text-sm font-medium">
          {label}
        </span>
      }>
      <Select
        items={items}
        value={value}
        onValueChange={(next) => {
          const item = items.find((candidate) => candidate.value === next)

          if (item) {
            onChange(item.value)
          }
        }}>
        <SelectTrigger
          aria-describedby={`${id}-description`}
          aria-labelledby={`${id}-label`}
          className="w-full sm:w-80">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FormField>
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

function Fieldset({ legend, children }: { legend: string; children: ReactNode }) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-6 border-t pt-4">
      <legend className="pr-2 font-semibold">{legend}</legend>
      {children}
    </fieldset>
  )
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
      field: name,
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
          <FormField
            id={credential.id}
            description={channel ? t('fields.credential.keep') : t('fields.credential.description')}
            error={credential.error}
            label={
              <label htmlFor={credential.id} className="text-sm font-medium">
                {tAuthentication(values.authentication)}
              </label>
            }>
            {values.authentication === 'privateKey' ? (
              <Textarea
                id={credential.id}
                autoComplete="off"
                name="credential"
                rows={6}
                spellCheck={false}
                value={credential.value}
                aria-describedby={describedBy(credential.id, credential.error)}
                aria-invalid={credential.error !== null}
                className="font-mono text-xs"
                onChange={(event) => credential.onChange(event.target.value)}
              />
            ) : (
              <Input
                id={credential.id}
                autoComplete="new-password"
                name="credential"
                type="password"
                value={credential.value}
                aria-describedby={describedBy(credential.id, credential.error)}
                aria-invalid={credential.error !== null}
                className="sm:w-80"
                onChange={(event) => credential.onChange(event.target.value)}
              />
            )}
          </FormField>
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
