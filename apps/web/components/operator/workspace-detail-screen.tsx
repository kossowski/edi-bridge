'use client'

import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'

import { AppPage } from '@/components/app-page'
import { Fact, Failure } from '@/components/detail-parts'
import { SandboxReset } from '@/components/operator/sandbox-reset'
import { WorkspaceInvites } from '@/components/operator/workspace-invites'
import { WorkspaceKindBadge } from '@/components/operator/workspace-kind-badge'
import { WorkspaceSettingsSection } from '@/components/operator/workspace-settings-section'
import {
  WorkspaceCreatedAt,
  WorkspaceGln,
  WorkspaceLastReset,
  WorkspaceMembers,
  WorkspaceSeeded,
} from '@/components/operator/workspace-values'
import { operatorWorkspacesQuery } from '@/lib/api/queries'
import { Separator } from '@edi-bridge/ui/components/separator'
import { Skeleton } from '@edi-bridge/ui/components/skeleton'

import type { WorkspaceSummary } from '@edi-bridge/contracts'

function WorkspaceFacts({
  workspace,
  isSandbox,
}: {
  workspace: WorkspaceSummary
  isSandbox: boolean
}) {
  const t = useTranslations('Operator.workspace.facts')

  return (
    <dl
      aria-label={t('label')}
      className="grid grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] gap-x-6 gap-y-4 rounded-lg border p-4">
      <Fact label={t('gln')}>
        <WorkspaceGln gln={workspace.gln} />
      </Fact>
      <Fact label={t('members')}>
        <WorkspaceMembers count={workspace.memberCount} />
      </Fact>
      <Fact label={t('seeded')}>
        <WorkspaceSeeded seeded={workspace.seeded} />
      </Fact>
      <Fact label={t('createdAt')}>
        <WorkspaceCreatedAt createdAt={workspace.createdAt} />
      </Fact>
      {isSandbox && (
        <Fact label={t('lastResetAt')}>
          <WorkspaceLastReset lastResetAt={workspace.lastResetAt} />
        </Fact>
      )}
    </dl>
  )
}

function WorkspaceView({ workspace }: { workspace: WorkspaceSummary }) {
  const isSandbox = workspace.kind === 'sandbox'

  return (
    <>
      <WorkspaceFacts isSandbox={isSandbox} workspace={workspace} />
      <WorkspaceInvites workspaceId={workspace.id} />
      <Separator />
      <WorkspaceSettingsSection workspaceId={workspace.id} />
    </>
  )
}

function WorkspaceLoading() {
  const t = useTranslations('Operator.workspace')

  return (
    <div aria-busy className="flex flex-col gap-6">
      <p role="status" className="sr-only">
        {t('loading')}
      </p>
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-64 w-full" />
    </div>
  )
}

export function WorkspaceDetailScreen({ id }: { id: string }) {
  const t = useTranslations('Operator.workspace')

  const { data, isPending, isError, refetch } = useQuery({
    ...operatorWorkspacesQuery,
    select: (workspaces) => workspaces.find((workspace) => workspace.id === id) ?? null,
  })

  return (
    <AppPage
      actions={data?.kind === 'sandbox' && <SandboxReset workspace={data} />}
      meta={data && <WorkspaceKindBadge kind={data.kind} />}
      name={data?.name}>
      {isPending ? (
        <WorkspaceLoading />
      ) : data ? (
        <WorkspaceView key={data.id} workspace={data} />
      ) : (
        <Failure
          error={{
            title: t('error.title'),
            description: t('error.description'),
            retry: t('error.retry'),
          }}
          notFound={
            isError ? null : { title: t('notFound.title'), description: t('notFound.description') }
          }
          onRetry={() => void refetch()}
        />
      )}
    </AppPage>
  )
}
