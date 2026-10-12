'use client'

import { CheckmarkCircle02Icon, SparklesIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useFormatter, useTranslations } from 'next-intl'
import Link from 'next/link'
import { type FormEvent, type RefObject, useLayoutEffect, useRef, useState } from 'react'

import { channelAddress } from '@/components/channels/channel-parts'
import { linkClass } from '@/components/detail-parts'
import { aiDraftStartHref } from '@/components/mappings/ai-draft-run'
import { usePlainNames } from '@/components/plain-names'
import { ChoiceCards } from '@/components/trading-partners/choice-cards'
import {
  aiMappingChoice,
  chosenOrOnly,
  documentConnections,
  latestMappingVersions,
  newDocumentFlow,
} from '@/components/trading-partners/partner-documents'
import { ApiError, createFlow, createMapping } from '@/lib/api/client'
import {
  flowsQuery,
  mappingKeys,
  publishedMappingVersionsQuery,
  storeSavedFlow,
  tradingPartnerKeys,
} from '@/lib/api/queries'
import {
  type Channel,
  directionOf,
  type Flow,
  type MappingSummary,
  newMappingMessageTypes,
} from '@edi-bridge/contracts'
import { Button, buttonVariants } from '@edi-bridge/ui/components/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@edi-bridge/ui/components/sheet'

import type { TradingPartner } from '@edi-bridge/contracts'

type NewMappingMessageType = (typeof newMappingMessageTypes)[number]

type Drafting = { mapping: MappingSummary; document: string }

function DraftingMapping({ drafting, onDone }: { drafting: Drafting; onDone: () => void }) {
  const t = useTranslations('TradingPartner.addDocument.drafting')
  const created = useRef<HTMLParagraphElement>(null)

  useLayoutEffect(() => {
    created.current?.focus()
  }, [])

  return (
    <div className="flex flex-col gap-4">
      <p ref={created} tabIndex={-1} className="flex items-start gap-2 text-sm outline-none">
        <HugeiconsIcon
          icon={CheckmarkCircle02Icon}
          strokeWidth={2}
          aria-hidden
          className="text-success-text mt-0.5 size-4 shrink-0"
        />
        {t('created', { mapping: drafting.mapping.name })}
      </p>
      <p className="text-sm">{t('next', { document: drafting.document })}</p>
      <div className="flex flex-wrap gap-2">
        <Link href={aiDraftStartHref(drafting.mapping.id)} className={buttonVariants()}>
          <HugeiconsIcon icon={SparklesIcon} strokeWidth={2} aria-hidden data-icon="inline-start" />
          {t('open')}
        </Link>
        <Button variant="outline" onClick={onDone}>
          {t('done')}
        </Button>
      </div>
    </div>
  )
}

function ConnectionChoice({
  label,
  channels,
  value,
  onChange,
}: {
  label: string
  channels: ReadonlyArray<Channel>
  value: string | null
  onChange: (id: string) => void
}) {
  const t = useTranslations('TradingPartner.connections.how')

  return (
    <ChoiceCards
      items={channels.map((channel) => ({
        value: channel.id,
        title: channel.name,
        description: `${t(channel.type)} · ${channelAddress(channel)}`,
      }))}
      label={label}
      value={value}
      onChange={onChange}
    />
  )
}

function DocumentRouteForm({
  tradingPartner,
  messageType,
  channels,
  onAdded,
  onDrafting,
  onCancel,
  onAddConnection,
}: {
  tradingPartner: TradingPartner
  messageType: NewMappingMessageType
  channels: ReadonlyArray<Channel>
  onAdded: (status: string) => void
  onDrafting: (drafting: Drafting) => void
  onCancel: () => void
  onAddConnection: () => void
}) {
  const t = useTranslations('TradingPartner.addDocument')
  const tVersion = useTranslations('Flow')
  const format = useFormatter()
  const plainNames = usePlainNames()
  const queryClient = useQueryClient()
  const name = tradingPartner.name
  const direction = directionOf({ messageType })
  const document = plainNames.messageTypeName(messageType, true)
  const [partnerChoice, setPartnerChoice] = useState<string | null>(null)
  const [ownChoice, setOwnChoice] = useState<string | null>(null)
  const [chosenMappingVersion, setChosenMappingVersion] = useState<string | null>(null)
  const versions = useQuery(publishedMappingVersionsQuery(messageType))

  const add = useMutation({
    mutationFn: createFlow,
    onSuccess: (flow) => {
      queryClient.setQueryData<Flow[]>(flowsQuery.queryKey, (flows) => flows && [...flows, flow])
      storeSavedFlow(queryClient, flow)
      void queryClient.invalidateQueries({
        queryKey: tradingPartnerKeys.activity(tradingPartner.id),
      })
      void queryClient.invalidateQueries({ queryKey: tradingPartnerKeys.activities() })
      onAdded(t('added', { document, name }))
    },
  })

  const draft = useMutation({
    mutationFn: createMapping,
    onSuccess: (mapping) => {
      void queryClient.invalidateQueries({ queryKey: mappingKeys.list() })
      onDrafting({ mapping, document })
    },
  })

  const pending = add.isPending || draft.isPending
  const connections = documentConnections(channels, messageType, tradingPartner.id)
  const partnerChannelIds = connections.partner.map(({ id }) => id)
  const partnerChannelId = chosenOrOnly(partnerChoice, partnerChannelIds)
  const ownChannelIds = connections.own.map(({ id }) => id)
  const ownChannelId = chosenOrOnly(ownChoice, ownChannelIds)
  const ownChannel = connections.own.length === 1 ? connections.own[0] : undefined
  const mappings = latestMappingVersions(versions.data ?? [])
  const mappingVersionChoice = chosenMappingVersion ?? mappings[0]?.id ?? aiMappingChoice
  const withAi = mappingVersionChoice === aiMappingChoice
  const ready = partnerChannelId !== null && ownChannelId !== null && !versions.isPending
  const noDataFormat = draft.error instanceof ApiError && draft.error.status === 422

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (pending || partnerChannelId === null || ownChannelId === null) {
      return
    }

    if (withAi) {
      draft.mutate({ messageType })

      return
    }

    add.mutate(
      newDocumentFlow({
        name: t(`routeName.${direction}`, { document, name }),
        tradingPartnerId: tradingPartner.id,
        messageType,
        partnerChannelId,
        ownChannelId,
        mappingVersionId: mappingVersionChoice,
      }),
    )
  }

  function submitLabel() {
    if (withAi) {
      return draft.isPending ? t('creatingMapping') : t('createMapping')
    }

    return add.isPending ? t('creating') : t('create')
  }

  return (
    <form
      noValidate
      aria-busy={pending || undefined}
      className="flex flex-col gap-6"
      onSubmit={submit}>
      {connections.partner.length === 0 ? (
        <div className="bg-muted/50 flex flex-col items-start gap-3 rounded-lg p-3 text-sm">
          <p>{t(`connection.none.${direction}`, { name })}</p>
          <Button size="sm" type="button" variant="outline" onClick={onAddConnection}>
            {t('connection.add')}
          </Button>
        </div>
      ) : (
        <ConnectionChoice
          channels={connections.partner}
          label={t(`connection.label.${direction}`, { name })}
          value={partnerChannelId}
          onChange={setPartnerChoice}
        />
      )}
      {connections.own.length === 0 && (
        <p className="bg-muted/50 rounded-lg p-3 text-sm">
          {t.rich(`connection.own.none.${direction}`, {
            link: (chunks) => (
              <Link href="/channels" className={linkClass}>
                {chunks}
              </Link>
            ),
          })}
        </p>
      )}
      {ownChannel && (
        <p className="text-sm">
          {t(`connection.own.only.${direction}`, { channel: ownChannel.name })}
        </p>
      )}
      {connections.own.length > 1 && (
        <ConnectionChoice
          channels={connections.own}
          label={t(`connection.own.label.${direction}`)}
          value={ownChannelId}
          onChange={setOwnChoice}
        />
      )}
      {partnerChannelId !== null && ownChannelId !== null && versions.isPending && (
        <p role="status" className="text-muted-foreground text-sm">
          {t('mapping.loading')}
        </p>
      )}
      {ready && (
        <div className="flex flex-col gap-2">
          {versions.isError && (
            <p className="text-destructive-text text-sm">{t('mapping.failed')}</p>
          )}
          <ChoiceCards
            items={[
              ...mappings.map((version) => ({
                value: version.id,
                title: version.mappingName,
                description: tVersion('versionOption', {
                  version: version.version,
                  publishedAt: format.dateTime(new Date(version.publishedAt), {
                    dateStyle: 'medium',
                  }),
                }),
              })),
              {
                value: aiMappingChoice,
                title: t('mapping.ai.title'),
                description: t('mapping.ai.description'),
              },
            ]}
            label={t('mapping.label')}
            value={mappingVersionChoice}
            onChange={setChosenMappingVersion}
          />
        </div>
      )}
      {add.isError && (
        <p role="alert" className="text-destructive-text text-sm">
          {t('failed')}
        </p>
      )}
      {draft.isError && (
        <p role="alert" className="text-destructive-text text-sm">
          {noDataFormat ? t('noDataFormat') : t('mappingFailed')}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {ready && (
          <Button
            type="submit"
            aria-disabled={pending || undefined}
            className="aria-disabled:cursor-progress aria-disabled:opacity-50">
            {submitLabel()}
          </Button>
        )}
        <Button type="button" variant="outline" onClick={onCancel}>
          {t('cancel')}
        </Button>
      </div>
    </form>
  )
}

function AddDocumentForm({
  tradingPartner,
  channels,
  flows,
  onAdded,
  onDrafting,
  onCancel,
  onAddConnection,
}: {
  tradingPartner: TradingPartner
  channels: ReadonlyArray<Channel>
  flows: ReadonlyArray<Flow>
  onAdded: (status: string) => void
  onDrafting: (drafting: Drafting) => void
  onCancel: () => void
  onAddConnection: () => void
}) {
  const t = useTranslations('TradingPartner.addDocument')
  const [messageType, setMessageType] = useState<NewMappingMessageType | null>(null)

  return (
    <div className="flex flex-col gap-6">
      <DocumentChoices
        flows={flows}
        tradingPartner={tradingPartner}
        value={messageType}
        onChange={setMessageType}
      />
      {messageType === null ? (
        <Button type="button" variant="outline" className="w-fit" onClick={onCancel}>
          {t('cancel')}
        </Button>
      ) : (
        <DocumentRouteForm
          key={messageType}
          channels={channels}
          messageType={messageType}
          tradingPartner={tradingPartner}
          onAddConnection={onAddConnection}
          onAdded={onAdded}
          onCancel={onCancel}
          onDrafting={onDrafting}
        />
      )}
    </div>
  )
}

function DocumentChoices({
  tradingPartner,
  flows,
  value,
  onChange,
}: {
  tradingPartner: TradingPartner
  flows: ReadonlyArray<Flow>
  value: NewMappingMessageType | null
  onChange: (value: NewMappingMessageType) => void
}) {
  const t = useTranslations('TradingPartner.addDocument.document')
  const plainNames = usePlainNames()

  return (
    <ChoiceCards
      items={newMappingMessageTypes.map((messageType) => ({
        value: messageType,
        title: plainNames.messageTypeName(messageType, true),
        description: t(directionOf({ messageType }), { name: tradingPartner.name }),
        badge: flows.some((flow) => flow.messageType === messageType) ? t('existing') : undefined,
      }))}
      label={t('label')}
      value={value}
      onChange={onChange}
    />
  )
}

export function AddDocumentSheet({
  tradingPartner,
  channels,
  flows,
  open,
  onOpenChange,
  onAdded,
  onAddConnection,
  finalFocus,
}: {
  tradingPartner: TradingPartner
  channels: ReadonlyArray<Channel>
  flows: ReadonlyArray<Flow>
  open: boolean
  onOpenChange: (open: boolean) => void
  onAdded: (status: string) => void
  onAddConnection: () => void
  finalFocus: RefObject<HTMLElement | null>
}) {
  const t = useTranslations('TradingPartner.addDocument')
  const [drafting, setDrafting] = useState<Drafting | null>(null)

  function changeOpen(next: boolean) {
    if (!next) {
      setDrafting(null)
    }

    onOpenChange(next)
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
          {drafting ? (
            <DraftingMapping drafting={drafting} onDone={() => changeOpen(false)} />
          ) : (
            <AddDocumentForm
              channels={channels}
              flows={flows}
              tradingPartner={tradingPartner}
              onAddConnection={onAddConnection}
              onAdded={(status) => {
                onAdded(status)
                changeOpen(false)
              }}
              onCancel={() => changeOpen(false)}
              onDrafting={setDrafting}
            />
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
