'use client'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useFormatter, useTranslations } from 'next-intl'

import { BackLink, Fact, Failure } from '@/components/detail-parts'
import { WorkspaceInvites } from '@/components/operator/workspace-invites'
import { WorkspaceKindBadge } from '@/components/operator/workspace-kind-badge'
import { RetentionAndBudgetForm } from '@/components/settings/retention-and-budget-form'
import { SettingsSection } from '@/components/settings/settings-section'
import { useSession } from '@/hooks/use-session'
import { updateOperatorWorkspaceSettings } from '@/lib/api/client'
import {
  operatorWorkspaceSettingsQuery,
  operatorWorkspacesQuery,
  workspaceSettingsQuery,
} from '@/lib/api/queries'
import { Separator } from '@edi-bridge/ui/components/separator'
import { Skeleton } from '@edi-bridge/ui/components/skeleton'

import type { WorkspaceSettingsInput, WorkspaceSummary } from '@edi-bridge/contracts'

function WorkspaceFacts({ workspace }: { workspace: WorkspaceSummary }) {
  const t = useTranslations('Operator.workspace.facts')
  const tList = useTranslations('Operator.workspaces')
  const format = useFormatter()

  return (
    <dl
      aria-label={t('label')}
      className="grid grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] gap-x-6 gap-y-4 rounded-lg border p-4">
      <Fact label={t('gln')}>
        {workspace.gln ? (
          <span className="font-mono tabular-nums">{workspace.gln}</span>
        ) : (
          <span className="text-muted-foreground">{tList('noGln')}</span>
        )}
      </Fact>
      <Fact label={t('members')}>{format.number(workspace.memberCount)}</Fact>
      <Fact label={t('seeded')}>{workspace.seeded ? tList('seeded.yes') : tList('seeded.no')}</Fact>
      <Fact label={t('createdAt')}>
        {format.dateTime(new Date(workspace.createdAt), { dateStyle: 'medium' })}
      </Fact>
    </dl>
  )
}

function WorkspaceSettingsSection({ workspaceId }: { workspaceId: string }) {
  const t = useTranslations('Operator.settings')
  const queryClient = useQueryClient()
  const { session } = useSession()
  const settingsQuery = operatorWorkspaceSettingsQuery(workspaceId)
  const { data, status, refetch } = useQuery(settingsQuery)

  async function save(input: WorkspaceSettingsInput) {
    const updated = await updateOperatorWorkspaceSettings(workspaceId, input)
    queryClient.setQueryData(settingsQuery.queryKey, updated)

    if (session?.workspace.id === workspaceId) {
      void queryClient.invalidateQueries({ queryKey: workspaceSettingsQuery.queryKey })
    }

    return updated
  }

  return (
    <SettingsSection
      description={t('description')}
      status={status}
      title={t('title')}
      onRetry={() => void refetch()}>
      {data && <RetentionAndBudgetForm editable save={save} settings={data} />}
    </SettingsSection>
  )
}

function WorkspaceView({ workspace }: { workspace: WorkspaceSummary }) {
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <h1 className="min-w-0 text-2xl font-semibold tracking-tight break-words">
            {workspace.name}
          </h1>
          <WorkspaceKindBadge kind={workspace.kind} />
        </div>
      </div>
      <WorkspaceFacts workspace={workspace} />
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
      <Skeleton className="h-8 w-64" />
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
    <div className="flex min-w-0 flex-1 flex-col gap-6 p-6">
      <BackLink href="/operator" label={t('back')} />
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
    </div>
  )
}
