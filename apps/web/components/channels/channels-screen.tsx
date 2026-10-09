'use client'

import { Add01Icon, AlertCircleIcon, PlugSocketIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { useId, useMemo, useState } from 'react'

import { channelAddress, useChannelKindLabel } from '@/components/channels/channel-parts'
import { channelsQuery, tradingPartnersQuery } from '@/lib/api/queries'
import { Button, buttonVariants } from '@edi-bridge/ui/components/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@edi-bridge/ui/components/empty'
import { Input } from '@edi-bridge/ui/components/input'
import { Skeleton } from '@edi-bridge/ui/components/skeleton'
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@edi-bridge/ui/components/table'

import type { Channel } from '@edi-bridge/contracts'

const columns = ['name', 'kind', 'tradingPartner', 'address'] as const

function ChannelRow({
  channel,
  tradingPartnerName,
}: {
  channel: Channel
  tradingPartnerName: string
}) {
  const kindLabel = useChannelKindLabel()

  return (
    <TableRow className="relative">
      <TableCell>
        <Link
          href={`/channels/${channel.id}`}
          className="focus-visible:after:ring-ring font-medium underline-offset-4 outline-none after:absolute after:inset-0 hover:underline focus-visible:underline focus-visible:after:ring-2 focus-visible:after:ring-inset">
          {channel.name}
        </Link>
      </TableCell>
      <TableCell>{kindLabel(channel)}</TableCell>
      <TableCell>{tradingPartnerName}</TableCell>
      <TableCell title={channelAddress(channel)} className="max-w-80 truncate font-mono text-xs">
        {channelAddress(channel)}
      </TableCell>
    </TableRow>
  )
}

function LoadingRows({ count }: { count: number }) {
  return Array.from({ length: count }, (_, index) => (
    <TableRow key={index}>
      {columns.map((column) => (
        <TableCell key={column}>
          <Skeleton className="h-4 w-full max-w-32" />
        </TableCell>
      ))}
    </TableRow>
  ))
}

function matches(channel: Channel, tradingPartnerName: string, search: string) {
  const term = search.trim().toLocaleLowerCase()

  return (
    term === '' ||
    [channel.name, tradingPartnerName, channelAddress(channel)].some((text) =>
      text.toLocaleLowerCase().includes(term),
    )
  )
}

function ChannelsTable() {
  const t = useTranslations('Channels')
  const searchId = useId()
  const [search, setSearch] = useState('')
  const channels = useQuery(channelsQuery)
  const tradingPartners = useQuery(tradingPartnersQuery)

  const tradingPartnerNames = useMemo(
    () => new Map(tradingPartners.data?.map(({ id, name }) => [id, name])),
    [tradingPartners.data],
  )

  function tradingPartnerName(channel: Channel) {
    return channel.tradingPartnerId === null
      ? t('ownSystems')
      : (tradingPartnerNames.get(channel.tradingPartnerId) ?? t('unknownTradingPartner'))
  }

  if (channels.isError) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <HugeiconsIcon icon={AlertCircleIcon} strokeWidth={2} />
          </EmptyMedia>
          <EmptyTitle>{t('error.title')}</EmptyTitle>
          <EmptyDescription>{t('error.description')}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button variant="outline" onClick={() => void channels.refetch()}>
            {t('error.retry')}
          </Button>
        </EmptyContent>
      </Empty>
    )
  }

  if (channels.data?.length === 0) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <HugeiconsIcon icon={PlugSocketIcon} strokeWidth={2} />
          </EmptyMedia>
          <EmptyTitle>{t('empty.title')}</EmptyTitle>
          <EmptyDescription>{t('empty.description')}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Link href="/channels/new" className={buttonVariants()}>
            <HugeiconsIcon icon={Add01Icon} strokeWidth={2} aria-hidden />
            {t('new')}
          </Link>
        </EmptyContent>
      </Empty>
    )
  }

  const pending = channels.isPending || tradingPartners.isPending

  const shown = (channels.data ?? []).filter((channel) =>
    matches(channel, tradingPartnerName(channel), search),
  )

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex w-full flex-col gap-1.5 sm:w-72">
          <label htmlFor={searchId} className="text-sm font-medium">
            {t('search')}
          </label>
          <Input
            id={searchId}
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <p aria-live="polite" className="text-muted-foreground text-sm">
          {pending
            ? t('loading')
            : search.trim() === ''
              ? t('count', { count: shown.length })
              : t('filteredCount', { count: shown.length, total: channels.data?.length ?? 0 })}
        </p>
      </div>
      <div className="rounded-lg border">
        <Table aria-busy={pending}>
          <TableCaption className="sr-only">{t('caption')}</TableCaption>
          <TableHeader>
            <TableRow>
              {columns.map((column) => (
                <TableHead key={column} scope="col">
                  {t(`columns.${column}`)}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {pending ? (
              <LoadingRows count={6} />
            ) : shown.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="text-muted-foreground py-6 text-center">
                  {t('noMatch')}
                </TableCell>
              </TableRow>
            ) : (
              shown.map((channel) => (
                <ChannelRow
                  key={channel.id}
                  channel={channel}
                  tradingPartnerName={tradingPartnerName(channel)}
                />
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

export function ChannelsScreen() {
  const t = useTranslations()

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-4 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{t('Navigation.channels')}</h1>
        <Link href="/channels/new" className={buttonVariants()}>
          <HugeiconsIcon icon={Add01Icon} strokeWidth={2} aria-hidden />
          {t('Channels.new')}
        </Link>
      </div>
      <ChannelsTable />
    </div>
  )
}
