'use client'

import { Add01Icon, Building03Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useQuery } from '@tanstack/react-query'
import { useFormatter, useTranslations } from 'next-intl'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { type ReactNode, type Ref, useId, useRef, useState } from 'react'

import { AppPage } from '@/components/app-page'
import { Notice, rowLinkClass } from '@/components/detail-parts'
import { LoadError } from '@/components/load-error'
import { CreateWorkspaceDialog } from '@/components/operator/create-workspace-dialog'
import { WorkspaceLastActivity } from '@/components/operator/workspace-values'
import { operatorWorkspacesQuery } from '@/lib/api/queries'
import { workspaceKinds, type WorkspaceKind, type WorkspaceSummary } from '@edi-bridge/contracts'
import { Button } from '@edi-bridge/ui/components/button'
import { Card, CardContent, CardHeader } from '@edi-bridge/ui/components/card'
import { Skeleton } from '@edi-bridge/ui/components/skeleton'

function CardFact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="tabular-nums">{children}</dd>
    </div>
  )
}

function WorkspaceCard({ workspace }: { workspace: WorkspaceSummary }) {
  const t = useTranslations('Operator.workspaces.card')
  const format = useFormatter()

  return (
    <li className="min-w-0">
      <Card size="sm" className="relative h-full">
        <CardHeader>
          <h3 className="truncate font-medium">
            <Link href={`/operator/workspaces/${workspace.id}`} className={rowLinkClass}>
              {workspace.name}
            </Link>
          </h3>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-3">
            <CardFact label={t('documentsToday')}>
              {format.number(workspace.documentsToday)}
            </CardFact>
            <CardFact label={t('lastActivity')}>
              <WorkspaceLastActivity lastActivityAt={workspace.lastActivityAt} />
            </CardFact>
            <CardFact label={t('members')}>{format.number(workspace.memberCount)}</CardFact>
            {workspace.pendingInviteCount > 0 && (
              <CardFact label={t('openInvites')}>
                {format.number(workspace.pendingInviteCount)}
              </CardFact>
            )}
          </dl>
        </CardContent>
      </Card>
    </li>
  )
}

function KindGroup({
  kind,
  workspaces,
}: {
  kind: WorkspaceKind
  workspaces: ReadonlyArray<WorkspaceSummary>
}) {
  const t = useTranslations('Operator.workspaces')
  const format = useFormatter()
  const id = useId()

  return (
    <section aria-labelledby={id} className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 id={id} className="font-semibold">
          {t(`groups.${kind}.title`)}{' '}
          <span className="text-muted-foreground font-normal tabular-nums">
            ({format.number(workspaces.length)})
          </span>
        </h2>
        <p className="text-muted-foreground text-sm">{t(`groups.${kind}.description`)}</p>
      </div>
      {workspaces.length === 0 ? (
        <p className="text-muted-foreground rounded-xl border border-dashed p-4 text-sm">
          {t(`groups.${kind}.empty`)}
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {workspaces.map((workspace) => (
            <WorkspaceCard key={workspace.id} workspace={workspace} />
          ))}
        </ul>
      )}
    </section>
  )
}

function WorkspacesLoading() {
  const t = useTranslations('Operator.workspaces')

  return (
    <div aria-busy className="flex flex-col gap-8">
      <p role="status" className="sr-only">
        {t('loading')}
      </p>
      {workspaceKinds.map((kind) => (
        <div key={kind} className="flex flex-col gap-3">
          <Skeleton className="h-5 w-40" />
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <Skeleton className="h-32 rounded-xl" />
            <Skeleton className="h-32 rounded-xl" />
          </div>
        </div>
      ))}
    </div>
  )
}

function CreateWorkspaceButton({
  ref,
  onClick,
}: {
  ref?: Ref<HTMLButtonElement>
  onClick: () => void
}) {
  const t = useTranslations('Operator.workspaces')

  return (
    <Button ref={ref} onClick={onClick}>
      <HugeiconsIcon icon={Add01Icon} strokeWidth={2} aria-hidden data-icon="inline-start" />
      {t('new')}
    </Button>
  )
}

export function WorkspacesScreen() {
  const t = useTranslations('Operator.workspaces')
  const tSession = useTranslations('Shell.session')
  const workspaces = useQuery(operatorWorkspacesQuery)
  const router = useRouter()
  const createButton = useRef<HTMLButtonElement>(null)
  const [dialog, setDialog] = useState({ open: false, run: 0 })

  function openDialog() {
    setDialog((current) => ({ open: true, run: current.run + 1 }))
  }

  function closeDialog() {
    setDialog((current) => ({ ...current, open: false }))
  }

  return (
    <AppPage
      actions={<CreateWorkspaceButton ref={createButton} onClick={openDialog} />}
      title={tSession('operatorArea')}
      className="gap-8">
      {workspaces.isPending ? (
        <WorkspacesLoading />
      ) : workspaces.isError ? (
        <LoadError
          description={t('error.description')}
          retryLabel={t('error.retry')}
          title={t('error.title')}
          onRetry={() => void workspaces.refetch()}
        />
      ) : workspaces.data.length === 0 ? (
        <Notice description={t('empty.description')} icon={Building03Icon} title={t('empty.title')}>
          <CreateWorkspaceButton onClick={openDialog} />
        </Notice>
      ) : (
        workspaceKinds.map((kind) => (
          <KindGroup
            key={kind}
            kind={kind}
            workspaces={workspaces.data.filter((workspace) => workspace.kind === kind)}
          />
        ))
      )}
      <CreateWorkspaceDialog
        key={dialog.run}
        finalFocus={createButton}
        open={dialog.open}
        onCreated={(workspace) => {
          router.push(`/operator/workspaces/${workspace.id}?tab=members`)
        }}
        onOpenChange={(open) => !open && closeDialog()}
      />
    </AppPage>
  )
}
