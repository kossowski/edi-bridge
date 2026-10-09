'use client'

import { ArrowRight02Icon, WorkflowSquare03Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import Link from 'next/link'

import { useFlowReferences } from '@/components/flows/flow-parts'
import { ListScreen, ListTable } from '@/components/list-screen'
import { flowsQuery } from '@/lib/api/queries'
import { Badge } from '@edi-bridge/ui/components/badge'
import { TableCell, TableRow } from '@edi-bridge/ui/components/table'

import type { Flow } from '@edi-bridge/contracts'

const columns = ['name', 'tradingPartner', 'messageType', 'route', 'mappingVersion'] as const

type References = ReturnType<typeof useFlowReferences>

function FlowRow({ flow, references }: { flow: Flow; references: References }) {
  const t = useTranslations('Flows')
  const { tradingPartners, channels } = references

  return (
    <TableRow className="relative">
      <TableCell>
        <Link
          href={`/flows/${flow.id}`}
          className="focus-visible:after:ring-ring font-medium underline-offset-4 outline-none after:absolute after:inset-0 hover:underline focus-visible:underline focus-visible:after:ring-2 focus-visible:after:ring-inset">
          {flow.name}
        </Link>
      </TableCell>
      <TableCell>{tradingPartners.name(flow.tradingPartnerId)}</TableCell>
      <TableCell>
        <code className="font-mono text-xs">{flow.messageType}</code>
      </TableCell>
      <TableCell className="whitespace-normal">
        <span className="flex flex-wrap items-center gap-x-1.5">
          <span>{channels.name(flow.inboundChannelId)}</span>
          <HugeiconsIcon
            icon={ArrowRight02Icon}
            strokeWidth={2}
            aria-hidden
            className="text-muted-foreground size-4"
          />
          <span className="sr-only">{t('routeTo')}</span>
          <span>{channels.name(flow.destinationChannelId)}</span>
        </span>
      </TableCell>
      <TableCell className="whitespace-normal">
        <span className="flex flex-col items-start gap-1">
          <span title={flow.mappingVersion.mappingName}>
            {t('version', { version: flow.mappingVersion.version })}
          </span>
          {flow.newerMappingVersions.length > 0 && (
            <Badge variant="outline">{t('newerAvailable')}</Badge>
          )}
        </span>
      </TableCell>
    </TableRow>
  )
}

function FlowsTable() {
  const t = useTranslations('Flows')
  const flows = useQuery(flowsQuery)
  const references = useFlowReferences()
  const { tradingPartners, channels } = references

  return (
    <ListTable
      columns={columns.map((key) => ({ key, label: t(`columns.${key}`) }))}
      emptyIcon={WorkflowSquare03Icon}
      matches={(flow, term) =>
        [
          flow.name,
          flow.messageType,
          tradingPartners.name(flow.tradingPartnerId),
          channels.name(flow.inboundChannelId),
          channels.name(flow.destinationChannelId),
          flow.mappingVersion.mappingName,
        ].some((text) => text.toLocaleLowerCase().includes(term))
      }
      newHref="/flows/new"
      pending={references.isPending}
      query={flows}
      row={(flow) => <FlowRow key={flow.id} flow={flow} references={references} />}
      t={t}
    />
  )
}

export function FlowsScreen() {
  const t = useTranslations()

  return (
    <ListScreen newHref="/flows/new" newLabel={t('Flows.new')} title={t('Navigation.flows')}>
      <FlowsTable />
    </ListScreen>
  )
}
