'use client'

import { UserMultiple02Icon } from '@hugeicons/core-free-icons'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import Link from 'next/link'

import { ListScreen, ListTable } from '@/components/list-screen'
import { TestModeBadge } from '@/components/trading-partners/test-mode-badge'
import { currentWorkspaceQuery, tradingPartnersQuery } from '@/lib/api/queries'
import { onboardingChecklist, type TradingPartner } from '@edi-bridge/contracts'
import { TableCell, TableRow } from '@edi-bridge/ui/components/table'

const columns = [
  'name',
  'gln',
  'mode',
  'onboarding',
  'characterSet',
  'acknowledgementTimeLimit',
] as const

function OnboardingProgress({
  tradingPartner,
  workspaceGln,
}: {
  tradingPartner: TradingPartner
  workspaceGln: string | null
}) {
  const t = useTranslations('TradingPartners')
  const tSteps = useTranslations('TradingPartner.onboarding.steps')

  const current = onboardingChecklist(tradingPartner, workspaceGln).find(
    ({ state }) => state === 'current',
  )

  return current ? t('nextStep', { step: tSteps(`${current.step}.title`) }) : t('complete')
}

function TradingPartnerRow({
  tradingPartner,
  workspaceGln,
}: {
  tradingPartner: TradingPartner
  workspaceGln: string | null
}) {
  const t = useTranslations('TradingPartners')

  return (
    <TableRow className="relative">
      <TableCell>
        <Link
          href={`/trading-partners/${tradingPartner.id}`}
          className="focus-visible:after:ring-ring font-medium underline-offset-4 outline-none after:absolute after:inset-0 hover:underline focus-visible:underline focus-visible:after:ring-2 focus-visible:after:ring-inset">
          {tradingPartner.name}
        </Link>
      </TableCell>
      <TableCell className="font-mono text-xs tabular-nums">{tradingPartner.gln}</TableCell>
      <TableCell>
        <TestModeBadge testMode={tradingPartner.testMode} />
      </TableCell>
      <TableCell>
        <OnboardingProgress tradingPartner={tradingPartner} workspaceGln={workspaceGln} />
      </TableCell>
      <TableCell className="font-mono text-xs">{tradingPartner.characterSet}</TableCell>
      <TableCell className="tabular-nums">
        {t('hours', { hours: tradingPartner.acknowledgementTimeLimitHours })}
      </TableCell>
    </TableRow>
  )
}

function TradingPartnersTable() {
  const t = useTranslations('TradingPartners')
  const tradingPartners = useQuery(tradingPartnersQuery)
  const workspace = useQuery(currentWorkspaceQuery)
  const workspaceGln = workspace.data?.gln ?? null

  return (
    <ListTable
      columns={columns.map((key) => ({ key, label: t(`columns.${key}`) }))}
      emptyIcon={UserMultiple02Icon}
      matches={(tradingPartner, term) =>
        tradingPartner.name.toLocaleLowerCase().includes(term) ||
        tradingPartner.gln.includes(term.replaceAll(/\s/g, ''))
      }
      newLink={{ href: '/trading-partners/new', label: t('new') }}
      pending={workspace.isPending}
      query={tradingPartners}
      row={(tradingPartner) => (
        <TradingPartnerRow
          key={tradingPartner.id}
          tradingPartner={tradingPartner}
          workspaceGln={workspaceGln}
        />
      )}
      t={t}
    />
  )
}

export function TradingPartnersScreen() {
  const t = useTranslations()

  return (
    <ListScreen
      newHref="/trading-partners/new"
      newLabel={t('TradingPartners.new')}
      title={t('Navigation.tradingPartners')}>
      <TradingPartnersTable />
    </ListScreen>
  )
}
