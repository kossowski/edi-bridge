'use client'

import {
  Add01Icon,
  ArrowUp02Icon,
  CheckmarkCircle02Icon,
  File02Icon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { type ReactNode, type RefObject, useId, useRef, useState } from 'react'

import { linkClass } from '@/components/detail-parts'
import { ListEmpty } from '@/components/list-table'
import { LoadError } from '@/components/load-error'
import { MessageTypeName } from '@/components/plain-names'
import { Term } from '@/components/term'
import { AddDocumentSheet } from '@/components/trading-partners/add-document-sheet'
import { newestVersion, partnerDocuments } from '@/components/trading-partners/partner-documents'
import { type PartnerPanelProps } from '@/components/trading-partners/partner-page-helpers'
import { useSession } from '@/hooks/use-session'
import { moveFlowMappingVersion } from '@/lib/api/client'
import { channelsQuery, flowsQuery, storeSavedFlow } from '@/lib/api/queries'
import {
  type Channel,
  directionOf,
  type Flow,
  type MappingVersionSummary,
} from '@edi-bridge/contracts'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@edi-bridge/ui/components/alert-dialog'
import { Button } from '@edi-bridge/ui/components/button'
import { Skeleton } from '@edi-bridge/ui/components/skeleton'

function MoveToVersion({
  flow,
  version,
  finalFocus,
  onMoved,
}: {
  flow: Flow
  version: MappingVersionSummary
  finalFocus: RefObject<HTMLElement | null>
  onMoved: (moved: Flow) => void
}) {
  const t = useTranslations('TradingPartner.documents.move')
  const queryClient = useQueryClient()
  const cancel = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)

  const move = useMutation({
    mutationFn: () => moveFlowMappingVersion(flow.id, { mappingVersionId: version.id }),
    onSuccess: (moved) => {
      queryClient.setQueryData<Flow[]>(flowsQuery.queryKey, (flows) =>
        flows?.map((candidate) => (candidate.id === moved.id ? moved : candidate)),
      )
      storeSavedFlow(queryClient, moved)
      setOpen(false)
      onMoved(moved)
    },
  })

  function changeOpen(next: boolean) {
    if (move.isPending) {
      return
    }

    if (next) {
      move.reset()
    }

    setOpen(next)
  }

  return (
    <AlertDialog open={open} onOpenChange={changeOpen}>
      <AlertDialogTrigger render={<Button size="sm" variant="outline" className="w-fit" />}>
        <HugeiconsIcon icon={ArrowUp02Icon} strokeWidth={2} aria-hidden data-icon="inline-start" />
        {t('button', { version: version.version })}
        <span className="sr-only"> {t('for', { route: flow.name })}</span>
      </AlertDialogTrigger>
      <AlertDialogContent
        finalFocus={finalFocus}
        initialFocus={cancel}
        aria-busy={move.isPending || undefined}>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t('title', { version: version.version, mapping: version.mappingName })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t('description', {
              route: flow.name,
              current: flow.mappingVersion.version,
              version: version.version,
            })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {move.isError && (
          <p role="alert" className="text-destructive-text text-sm">
            {t('failed')}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel
            ref={cancel}
            aria-disabled={move.isPending || undefined}
            className="aria-disabled:cursor-progress aria-disabled:opacity-50">
            {t('cancel')}
          </AlertDialogCancel>
          <AlertDialogAction
            aria-disabled={move.isPending || undefined}
            className="aria-disabled:cursor-progress aria-disabled:opacity-50"
            onClick={() => {
              if (!move.isPending) {
                move.mutate()
              }
            }}>
            {move.isPending ? t('pending') : t('confirm', { version: version.version })}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function ChannelName({ channel, fallback }: { channel: Channel | undefined; fallback: string }) {
  return channel ? (
    <Link href={`/channels/${channel.id}`} className={linkClass}>
      {channel.name}
    </Link>
  ) : (
    fallback
  )
}

function DocumentItem({
  flow,
  partnerName,
  channels,
  canChange,
  finalFocus,
  onMoved,
}: {
  flow: Flow
  partnerName: string
  channels: ReadonlyMap<string, Channel>
  canChange: boolean
  finalFocus: RefObject<HTMLElement | null>
  onMoved: (moved: Flow) => void
}) {
  const t = useTranslations('TradingPartner.documents')
  const newer = newestVersion(flow.newerMappingVersions)
  const unknown = t('unknownChannel')

  return (
    <li className="flex flex-col gap-3 p-4">
      <div className="flex flex-col gap-1">
        <h3 className="font-medium">
          <MessageTypeName messageType={flow.messageType} plural />
        </h3>
        <p className="text-sm">{t(`way.${directionOf(flow)}`, { name: partnerName })}</p>
      </div>
      <dl className="grid gap-x-4 gap-y-1.5 text-sm sm:grid-cols-[max-content_minmax(0,1fr)]">
        <dt className="text-muted-foreground">{t('route')}</dt>
        <dd className="min-w-0 break-words">
          <Link href={`/flows/${flow.id}`} className={linkClass}>
            {flow.name}
          </Link>
        </dd>
        <dt className="text-muted-foreground">{t('connections')}</dt>
        <dd className="min-w-0 break-words">
          {t.rich('connectionPath', {
            from: () => (
              <ChannelName channel={channels.get(flow.inboundChannelId)} fallback={unknown} />
            ),
            to: () => (
              <ChannelName channel={channels.get(flow.destinationChannelId)} fallback={unknown} />
            ),
          })}
        </dd>
        <dt className="text-muted-foreground">{t('mapping')}</dt>
        <dd className="min-w-0 break-words">
          {t.rich('mappingVersion', {
            mapping: flow.mappingVersion.mappingName,
            version: flow.mappingVersion.version,
            link: (chunks) => (
              <Link href={`/mappings/${flow.mappingVersion.mappingId}`} className={linkClass}>
                {chunks}
              </Link>
            ),
          })}
        </dd>
      </dl>
      {newer && (
        <div className="border-info/40 bg-info/10 flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 text-sm">
          <p className="flex min-w-0 flex-1 basis-60 flex-col gap-0.5">
            <span>
              {t('newer.available', {
                count: flow.newerMappingVersions.length,
                latest: newer.version,
              })}
            </span>
            <span>{t('newer.kept', { version: flow.mappingVersion.version })}</span>
          </p>
          {canChange && (
            <MoveToVersion finalFocus={finalFocus} flow={flow} version={newer} onMoved={onMoved} />
          )}
        </div>
      )}
    </li>
  )
}

function DocumentsLoading({ label }: { label: string }) {
  return (
    <div aria-busy className="flex flex-col gap-3">
      <p role="status" className="sr-only">
        {label}
      </p>
      <Skeleton className="h-6 w-64" />
      <Skeleton className="h-36 w-full rounded-lg" />
      <Skeleton className="h-36 w-full rounded-lg" />
    </div>
  )
}

function StatusLine({ children }: { children: ReactNode }) {
  return (
    <p role="status" className="flex items-center gap-2 text-sm empty:hidden">
      {children && (
        <>
          <HugeiconsIcon
            icon={CheckmarkCircle02Icon}
            strokeWidth={2}
            aria-hidden
            className="text-success-text size-4 shrink-0"
          />
          {children}
        </>
      )}
    </p>
  )
}

export function PartnerDocuments({
  tradingPartner,
  addingDocument,
  onAddingDocumentChange,
  onAddConnection,
}: PartnerPanelProps & {
  addingDocument: boolean
  onAddingDocumentChange: (adding: boolean) => void
  onAddConnection: () => void
}) {
  const t = useTranslations('TradingPartner.documents')
  const flows = useQuery(flowsQuery)
  const channels = useQuery(channelsQuery)
  const session = useSession()
  const titleId = useId()
  const heading = useRef<HTMLHeadingElement>(null)
  const addButton = useRef<HTMLButtonElement>(null)
  const [status, setStatus] = useState<string | null>(null)
  const name = tradingPartner.name
  const canChange = session.canChange

  if (flows.isPending || channels.isPending) {
    return <DocumentsLoading label={t('loading')} />
  }

  if (flows.isError || channels.isError) {
    return (
      <LoadError
        description={t('error.description')}
        retryLabel={t('error.retry')}
        title={t('error.title')}
        onRetry={() => {
          void flows.refetch()
          void channels.refetch()
        }}
      />
    )
  }

  const documents = partnerDocuments(flows.data, tradingPartner.id)
  const channelsById = new Map(channels.data.map((channel) => [channel.id, channel]))

  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="flex flex-col gap-1">
          <h2 id={titleId} ref={heading} tabIndex={-1} className="font-medium outline-none">
            {t('title', { name })}
          </h2>
          <p className="text-muted-foreground text-sm">
            {t.rich('description', {
              term: (chunks) => <Term glossaryKey="flow">{chunks}</Term>,
            })}
          </p>
        </div>
        {canChange && (
          <Button ref={addButton} onClick={() => onAddingDocumentChange(true)}>
            <HugeiconsIcon icon={Add01Icon} strokeWidth={2} aria-hidden data-icon="inline-start" />
            {t('add')}
          </Button>
        )}
      </div>
      <StatusLine>{status}</StatusLine>
      {documents.length === 0 ? (
        <ListEmpty
          description={t('empty.description', { name })}
          icon={File02Icon}
          title={t('empty.title')}
          viewOnlyDescription={t('empty.viewOnlyDescription')}
        />
      ) : (
        <ul aria-label={t('list', { name })} className="divide-y rounded-lg border">
          {documents.map((flow) => (
            <DocumentItem
              key={flow.id}
              canChange={canChange}
              channels={channelsById}
              finalFocus={heading}
              flow={flow}
              partnerName={name}
              onMoved={(moved) =>
                setStatus(
                  t('move.done', { route: moved.name, version: moved.mappingVersion.version }),
                )
              }
            />
          ))}
        </ul>
      )}
      {canChange && (
        <AddDocumentSheet
          channels={channels.data}
          documents={documents}
          finalFocus={addButton}
          open={addingDocument}
          tradingPartner={tradingPartner}
          onAddConnection={onAddConnection}
          onAdded={setStatus}
          onOpenChange={onAddingDocumentChange}
        />
      )}
    </section>
  )
}
