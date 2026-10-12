'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { type FormEvent, type ReactNode, type RefObject, useId, useRef, useState } from 'react'

import {
  ChannelKindFields,
  focusFirstError,
  useChannelFields,
} from '@/components/channels/channel-form'
import {
  type ChannelFormValues,
  type ChannelKindKey,
  toFormValues,
  validateNewChannel,
} from '@/components/channels/channel-form-values'
import { WebhookTokenReveal } from '@/components/channels/webhook-token'
import { CopyableValue } from '@/components/copy-button'
import { TextField } from '@/components/form-field'
import {
  defaultKindKey,
  kindKeysTravelling,
  suggestedName,
} from '@/components/trading-partners/partner-connections'
import { createChannel } from '@/lib/api/client'
import { storeSavedChannel, tradingPartnerKeys } from '@/lib/api/queries'
import { type CreatedChannel, type Direction, directions } from '@edi-bridge/contracts'
import { Badge } from '@edi-bridge/ui/components/badge'
import { Button } from '@edi-bridge/ui/components/button'
import { RadioGroup, RadioGroupItem } from '@edi-bridge/ui/components/radio-group'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@edi-bridge/ui/components/sheet'

import type { TradingPartner } from '@edi-bridge/contracts'

type Choice<Value extends string> = {
  value: Value
  title: string
  description: string
  badge?: string | undefined
}

function ChoiceCards<Value extends string>({
  label,
  value,
  items,
  onChange,
}: {
  label: string
  value: Value | null
  items: ReadonlyArray<Choice<Value>>
  onChange: (value: Value) => void
}) {
  const id = useId()

  return (
    <div className="flex flex-col gap-2">
      <span id={`${id}-label`} className="text-sm font-medium">
        {label}
      </span>
      <RadioGroup
        value={value}
        aria-labelledby={`${id}-label`}
        className="flex flex-col gap-2"
        onValueChange={(next) => {
          const item = items.find((candidate) => candidate.value === next)

          if (item) {
            onChange(item.value)
          }
        }}>
        {items.map((item) => (
          <label
            key={item.value}
            className="has-data-checked:border-primary has-data-checked:bg-muted/50 grid cursor-pointer grid-cols-[auto_1fr] items-start gap-x-3 gap-y-0.5 rounded-lg border p-3">
            <RadioGroupItem
              value={item.value}
              aria-describedby={`${id}-${item.value}`}
              className="mt-0.5"
            />
            <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
              {item.title}
              {item.badge && <Badge variant="secondary">{item.badge}</Badge>}
            </span>
            <span id={`${id}-${item.value}`} className="text-muted-foreground col-start-2 text-sm">
              {item.description}
            </span>
          </label>
        ))}
      </RadioGroup>
    </div>
  )
}

function CreatedWebhook({
  created,
  token,
  partnerName,
  children,
}: {
  created: CreatedChannel['channel']
  token: string
  partnerName: string
  children: ReactNode
}) {
  const t = useTranslations('TradingPartner.addConnection.webhook')

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm">{t('created', { name: created.name, partner: partnerName })}</p>
      {created.type === 'webhook' && (
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">{t('url')}</span>
          <CopyableValue label={t('url')} value={created.url} />
        </div>
      )}
      <WebhookTokenReveal token={token}>{children}</WebhookTokenReveal>
    </div>
  )
}

function AddConnectionForm({
  tradingPartner,
  onAdded,
  onCancel,
}: {
  tradingPartner: TradingPartner
  onAdded: (created: CreatedChannel) => void
  onCancel: () => void
}) {
  const t = useTranslations('TradingPartner.addConnection')
  const tField = useTranslations('ChannelForm.fields')
  const queryClient = useQueryClient()
  const formRef = useRef<HTMLFormElement>(null)
  const name = tradingPartner.name
  const [direction, setDirection] = useState<Direction | null>(null)
  const [nameEdited, setNameEdited] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  const [values, setValues] = useState<ChannelFormValues>(() => ({
    ...toFormValues(),
    tradingPartnerId: tradingPartner.id,
  }))

  const result = validateNewChannel(values)
  const errors = submitted && 'errors' in result ? result.errors : {}
  const fields = useChannelFields(values, setValues, errors)
  const nameField = fields.field('name')

  const create = useMutation({
    mutationFn: createChannel,
    onSuccess: (created) => {
      storeSavedChannel(queryClient, created.channel)
      void queryClient.invalidateQueries({
        queryKey: tradingPartnerKeys.activity(tradingPartner.id),
      })
      void queryClient.invalidateQueries({ queryKey: tradingPartnerKeys.activities() })
      onAdded(created)
    },
  })

  function chooseKind(kind: ChannelKindKey) {
    setValues((current) => ({
      ...current,
      kind,
      name: nameEdited ? current.name : suggestedName(t(`suggestedName.${kind}`, { name })),
    }))
  }

  function chooseDirection(next: Direction) {
    setDirection(next)
    chooseKind(defaultKindKey(next))
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitted(true)

    if ('errors' in result) {
      focusFirstError(formRef.current, result.errors)

      return
    }

    if (!create.isPending) {
      create.mutate(result.input)
    }
  }

  return (
    <form
      noValidate
      ref={formRef}
      aria-busy={create.isPending || undefined}
      className="flex flex-col gap-6"
      onSubmit={submit}>
      <ChoiceCards
        items={directions.map((value) => ({
          value,
          title: t(`way.${value}.title`, { name }),
          description: t(`way.${value}.description`),
        }))}
        label={t('way.label')}
        value={direction}
        onChange={chooseDirection}
      />
      {direction && (
        <>
          <ChoiceCards
            items={kindKeysTravelling(direction).map((value) => ({
              value,
              title: t(`how.${value}.title`, { name }),
              description: t(`how.${value}.description`),
              badge: value === defaultKindKey(direction) ? t('how.recommended') : undefined,
            }))}
            label={t('how.label')}
            value={values.kind}
            onChange={chooseKind}
          />
          <TextField
            {...nameField}
            autoComplete="off"
            description={t('name')}
            label={tField('name.label')}
            onChange={(next) => {
              setNameEdited(true)
              nameField.onChange(next)
            }}
          />
          <ChannelKindFields fields={fields} values={values} />
          {create.isError && (
            <p role="alert" className="text-destructive-text text-sm">
              {t('failed')}
            </p>
          )}
        </>
      )}
      <div className="flex flex-wrap gap-2">
        {direction && (
          <Button
            type="submit"
            aria-disabled={create.isPending || undefined}
            className="aria-disabled:cursor-progress aria-disabled:opacity-50">
            {create.isPending ? t('creating') : t('create')}
          </Button>
        )}
        <Button type="button" variant="outline" onClick={onCancel}>
          {t('cancel')}
        </Button>
      </div>
    </form>
  )
}

export function AddConnectionSheet({
  tradingPartner,
  open,
  onOpenChange,
  onAdded,
  finalFocus,
}: {
  tradingPartner: TradingPartner
  open: boolean
  onOpenChange: (open: boolean) => void
  onAdded: (name: string) => void
  finalFocus: RefObject<HTMLElement | null>
}) {
  const t = useTranslations('TradingPartner.addConnection')
  const [webhook, setWebhook] = useState<CreatedChannel | null>(null)

  function changeOpen(next: boolean) {
    if (!next) {
      setWebhook(null)
    }

    onOpenChange(next)
  }

  function added(created: CreatedChannel) {
    onAdded(created.channel.name)

    if (created.webhookToken === null) {
      changeOpen(false)
    } else {
      setWebhook(created)
    }
  }

  return (
    <Sheet open={open} onOpenChange={changeOpen}>
      <SheetContent
        closeLabel={t('close')}
        finalFocus={finalFocus}
        className="overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{t('title')}</SheetTitle>
          <SheetDescription>{t('description')}</SheetDescription>
        </SheetHeader>
        <div className="px-4 pb-6">
          {webhook?.webhookToken ? (
            <CreatedWebhook
              created={webhook.channel}
              partnerName={tradingPartner.name}
              token={webhook.webhookToken}>
              <Button className="w-fit" onClick={() => changeOpen(false)}>
                {t('webhook.done')}
              </Button>
            </CreatedWebhook>
          ) : (
            <AddConnectionForm
              tradingPartner={tradingPartner}
              onAdded={added}
              onCancel={() => changeOpen(false)}
            />
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
