'use client'

import {
  Add01Icon,
  Alert02Icon,
  CheckmarkCircle02Icon,
  Link04Icon,
  Loading03Icon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useMutation, type UseMutationResult, useQuery } from '@tanstack/react-query'
import { useFormatter, useNow, useTranslations } from 'next-intl'
import Link from 'next/link'
import { type ReactNode, useId, useRef, useState } from 'react'

import { channelAddress } from '@/components/channels/channel-parts'
import { linkClass } from '@/components/detail-parts'
import { ListEmpty } from '@/components/list-table'
import { LoadError } from '@/components/load-error'
import { Term } from '@/components/term'
import { AddConnectionSheet } from '@/components/trading-partners/add-connection-sheet'
import { partnerConnections } from '@/components/trading-partners/partner-connections'
import { type PartnerPanelProps } from '@/components/trading-partners/partner-page-helpers'
import { PanelLoading, StatusLine } from '@/components/trading-partners/partner-panel-parts'
import { useSession } from '@/hooks/use-session'
import { testChannel } from '@/lib/api/client'
import { channelsQuery } from '@/lib/api/queries'
import { Badge } from '@edi-bridge/ui/components/badge'
import { Button } from '@edi-bridge/ui/components/button'
import { cn } from '@edi-bridge/ui/lib/utils'

import type { Channel, ChannelTestResult } from '@edi-bridge/contracts'

function TestOutcome({ result }: { result: ChannelTestResult }) {
  const t = useTranslations('TradingPartner.connections.test')
  const format = useFormatter()
  const now = useNow({ updateInterval: 30_000 })

  const tested = t.rich('testedAt', {
    time: format.relativeTime(new Date(result.testedAt), now),
    when: (chunks) => <time dateTime={result.testedAt}>{chunks}</time>,
  })

  return result.outcome === 'succeeded' ? (
    <p className="flex items-start gap-2 text-sm">
      <HugeiconsIcon
        icon={CheckmarkCircle02Icon}
        strokeWidth={2}
        aria-hidden
        className="text-success-text mt-0.5 size-4 shrink-0"
      />
      <span>
        {t('succeeded')} <span className="text-muted-foreground">{tested}</span>
      </span>
    </p>
  ) : (
    <div className="border-destructive/30 bg-destructive/5 flex items-start gap-2 rounded-lg border p-3 text-sm">
      <HugeiconsIcon
        icon={Alert02Icon}
        strokeWidth={2}
        aria-hidden
        className="text-destructive-text mt-0.5 size-4 shrink-0"
      />
      <div className="flex flex-col gap-1">
        <p className="text-destructive-text font-medium">{t(`failed.${result.reason}.title`)}</p>
        <p>{t(`failed.${result.reason}.hint`)}</p>
        <p>{tested}</p>
      </div>
    </div>
  )
}

function TestStatus({
  channel,
  test,
}: {
  channel: Channel
  test: Pick<UseMutationResult<ChannelTestResult>, 'isPending' | 'isError' | 'data'>
}) {
  const t = useTranslations('TradingPartner.connections.test')

  if (test.isPending) {
    return <p className="sr-only">{t('pendingStatus', { name: channel.name })}</p>
  }

  if (test.isError) {
    return <p className="text-destructive-text text-sm">{t('requestFailed')}</p>
  }

  return test.data ? <TestOutcome result={test.data} /> : null
}

function TestConnection({ channel }: { channel: Channel }) {
  const t = useTranslations('TradingPartner.connections.test')

  const test = useMutation({ mutationFn: () => testChannel(channel.id) })

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        aria-disabled={test.isPending || undefined}
        className="w-fit shrink-0 aria-disabled:cursor-progress aria-disabled:opacity-70"
        onClick={() => {
          if (!test.isPending) {
            test.mutate()
          }
        }}>
        {test.isPending && (
          <HugeiconsIcon
            icon={Loading03Icon}
            strokeWidth={2}
            aria-hidden
            className="animate-spin motion-reduce:animate-none"
            data-icon="inline-start"
          />
        )}
        {test.isPending ? t('pending') : t('button')}
        <span className="sr-only"> {channel.name}</span>
      </Button>
      <div aria-live="polite" className="basis-full empty:hidden">
        <TestStatus channel={channel} test={test} />
      </div>
    </>
  )
}

function ConnectionItem({
  channel,
  partnerName,
  canTest,
}: {
  channel: Channel
  partnerName: string | null
  canTest: boolean
}) {
  const t = useTranslations('TradingPartner.connections')

  return (
    <li className="flex flex-wrap items-start justify-between gap-3 p-4">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/channels/${channel.id}`} className={cn(linkClass, 'font-medium')}>
            {channel.name}
          </Link>
          <Badge variant="outline">{t(`how.${channel.type}`)}</Badge>
        </div>
        <p className="text-sm">
          {partnerName === null
            ? t(`way.shared.${channel.direction}`)
            : t(`way.partner.${channel.direction}`, { name: partnerName })}
        </p>
        <p className="text-muted-foreground font-mono text-xs break-all">
          {channelAddress(channel)}
        </p>
      </div>
      {canTest && <TestConnection channel={channel} />}
    </li>
  )
}

function ConnectionSection({
  title,
  description,
  action,
  children,
}: {
  title: string
  description: ReactNode
  action?: ReactNode
  children: ReactNode
}) {
  const titleId = useId()

  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="flex flex-col gap-1">
          <h2 id={titleId} className="font-medium">
            {title}
          </h2>
          <p className="text-muted-foreground text-sm">{description}</p>
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

export function PartnerConnections({
  tradingPartner,
  addingConnection,
  onAddingConnectionChange,
}: PartnerPanelProps & {
  addingConnection: boolean
  onAddingConnectionChange: (adding: boolean) => void
}) {
  const t = useTranslations('TradingPartner.connections')
  const channels = useQuery(channelsQuery)
  const session = useSession()
  const addButton = useRef<HTMLButtonElement>(null)
  const [added, setAdded] = useState<string | null>(null)
  const name = tradingPartner.name
  const canChange = session.canChange

  if (channels.isPending) {
    return <PanelLoading label={t('loading')} />
  }

  if (channels.isError) {
    return (
      <LoadError
        description={t('error.description')}
        retryLabel={t('error.retry')}
        title={t('error.title')}
        onRetry={() => void channels.refetch()}
      />
    )
  }

  const { own, shared } = partnerConnections(channels.data, tradingPartner.id)

  return (
    <div className="flex flex-col gap-8">
      <ConnectionSection
        action={
          canChange && (
            <Button ref={addButton} onClick={() => onAddingConnectionChange(true)}>
              <HugeiconsIcon
                icon={Add01Icon}
                strokeWidth={2}
                aria-hidden
                data-icon="inline-start"
              />
              {t('add')}
            </Button>
          )
        }
        description={t.rich('own.description', {
          name,
          term: (chunks) => <Term glossaryKey="channel">{chunks}</Term>,
        })}
        title={t('own.title', { name })}>
        <StatusLine>{added && t('added', { name: added })}</StatusLine>
        {own.length === 0 ? (
          <ListEmpty
            description={t('empty.description', { name })}
            icon={Link04Icon}
            title={t('empty.title')}
            viewOnlyDescription={t('empty.viewOnlyDescription')}
          />
        ) : (
          <ul aria-label={t('own.list', { name })} className="divide-y rounded-lg border">
            {own.map((channel) => (
              <ConnectionItem
                key={channel.id}
                canTest={canChange}
                channel={channel}
                partnerName={name}
              />
            ))}
          </ul>
        )}
      </ConnectionSection>
      <ConnectionSection
        description={t.rich('shared.description', {
          link: (chunks) => (
            <Link href="/channels" className={linkClass}>
              {chunks}
            </Link>
          ),
        })}
        title={t('shared.title')}>
        {shared.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t('shared.empty')}</p>
        ) : (
          <ul aria-label={t('shared.list')} className="divide-y rounded-lg border">
            {shared.map((channel) => (
              <ConnectionItem
                key={channel.id}
                canTest={canChange}
                channel={channel}
                partnerName={null}
              />
            ))}
          </ul>
        )}
      </ConnectionSection>
      {canChange && (
        <AddConnectionSheet
          finalFocus={addButton}
          open={addingConnection}
          tradingPartner={tradingPartner}
          onAdded={setAdded}
          onOpenChange={onAddingConnectionChange}
        />
      )}
    </div>
  )
}
