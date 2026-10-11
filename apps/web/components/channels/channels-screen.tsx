'use client'

import { PlugSocketIcon } from '@hugeicons/core-free-icons'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import Link from 'next/link'

import { AppPage } from '@/components/app-page'
import {
  channelAddress,
  useChannelKindLabel,
  useChannelTradingPartners,
} from '@/components/channels/channel-parts'
import { rowLinkClass } from '@/components/detail-parts'
import { ListTable, NewLink } from '@/components/list-screen'
import { useCanChange } from '@/hooks/use-session'
import { channelsQuery } from '@/lib/api/queries'
import { TableCell, TableRow } from '@edi-bridge/ui/components/table'

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
        <Link href={`/channels/${channel.id}`} className={rowLinkClass}>
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

function ChannelsTable() {
  const t = useTranslations('Channels')
  const channels = useQuery(channelsQuery)
  const tradingPartners = useChannelTradingPartners()

  return (
    <ListTable
      columns={columns.map((key) => ({ key, label: t(`columns.${key}`) }))}
      emptyIcon={PlugSocketIcon}
      matches={(channel, term) =>
        [
          channel.name,
          tradingPartners.name(channel.tradingPartnerId),
          channelAddress(channel),
        ].some((text) => text.toLocaleLowerCase().includes(term))
      }
      newLink={{ href: '/channels/new', label: t('new') }}
      pending={tradingPartners.isPending}
      query={channels}
      row={(channel) => (
        <ChannelRow
          key={channel.id}
          channel={channel}
          tradingPartnerName={tradingPartners.name(channel.tradingPartnerId)}
        />
      )}
      t={t}
    />
  )
}

export function ChannelsScreen() {
  const t = useTranslations()
  const canChange = useCanChange()

  return (
    <AppPage
      actions={canChange && <NewLink href="/channels/new" label={t('Channels.new')} />}
      title={t('Navigation.channels')}>
      <ChannelsTable />
    </AppPage>
  )
}
