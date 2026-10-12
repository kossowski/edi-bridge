'use client'

import { useFormatter, useTranslations } from 'next-intl'

import type { ReactNode } from 'react'

import { Fact } from '@/components/detail-parts'
import { WorkspaceKindBadge } from '@/components/operator/workspace-kind-badge'
import {
  WorkspaceCreatedAt,
  WorkspaceGln,
  WorkspaceLastActivity,
  WorkspaceLastReset,
  WorkspaceSeeded,
} from '@/components/operator/workspace-values'

import type { WorkspaceSummary } from '@edi-bridge/contracts'

function Stat({ label, note, children }: { label: string; note?: string; children: ReactNode }) {
  return (
    <div className="bg-card flex flex-col gap-1 rounded-xl border p-4">
      <dt className="text-muted-foreground text-sm">{label}</dt>
      <dd className="text-xl font-semibold">{children}</dd>
      {note && <dd className="text-muted-foreground text-sm">{note}</dd>}
    </div>
  )
}

export function WorkspaceOverviewTab({ workspace }: { workspace: WorkspaceSummary }) {
  const t = useTranslations('Operator.workspace.overview')
  const format = useFormatter()

  return (
    <>
      <dl aria-label={t('label')} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={t('kind')} note={t(`kindDescription.${workspace.kind}`)}>
          <WorkspaceKindBadge kind={workspace.kind} />
        </Stat>
        <Stat
          label={t('members')}
          note={t('pendingInvites', { count: workspace.pendingInviteCount })}>
          <span className="tabular-nums">{format.number(workspace.memberCount)}</span>
        </Stat>
        <Stat label={t('documentsToday')}>
          <span className="tabular-nums">{format.number(workspace.documentsToday)}</span>
        </Stat>
        <Stat label={t('lastActivity')}>
          <span className="text-base">
            <WorkspaceLastActivity lastActivityAt={workspace.lastActivityAt} />
          </span>
        </Stat>
      </dl>
      <dl
        aria-label={t('detailsLabel')}
        className="grid grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] gap-x-6 gap-y-4 rounded-xl border p-4">
        <Fact label={t('gln')}>
          <WorkspaceGln gln={workspace.gln} />
        </Fact>
        <Fact label={t('seeded')}>
          <WorkspaceSeeded seeded={workspace.seeded} />
        </Fact>
        <Fact label={t('createdAt')}>
          <WorkspaceCreatedAt createdAt={workspace.createdAt} />
        </Fact>
        {workspace.kind === 'sandbox' && (
          <Fact label={t('lastReset')}>
            <WorkspaceLastReset lastResetAt={workspace.lastResetAt} />
          </Fact>
        )}
      </dl>
    </>
  )
}
