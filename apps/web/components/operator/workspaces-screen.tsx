'use client'

import { Add01Icon, Building03Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useQuery } from '@tanstack/react-query'
import { useFormatter, useTranslations } from 'next-intl'
import Link from 'next/link'
import { type Ref, useRef, useState } from 'react'

import { linkClass, rowLinkClass } from '@/components/detail-parts'
import { ListScreen, ListTable } from '@/components/list-screen'
import { CreateWorkspaceDialog } from '@/components/operator/create-workspace-dialog'
import { WorkspaceKindBadge } from '@/components/operator/workspace-kind-badge'
import { operatorWorkspacesQuery } from '@/lib/api/queries'
import { Button } from '@edi-bridge/ui/components/button'
import { TableCell, TableRow } from '@edi-bridge/ui/components/table'

import type { WorkspaceSummary } from '@edi-bridge/contracts'

const columns = ['name', 'kind', 'gln', 'members', 'seeded', 'createdAt'] as const

function WorkspaceRow({ workspace }: { workspace: WorkspaceSummary }) {
  const t = useTranslations('Operator.workspaces')
  const format = useFormatter()

  return (
    <TableRow className="relative">
      <TableCell className="max-w-72 truncate">
        <Link href={`/operator/workspaces/${workspace.id}`} className={rowLinkClass}>
          {workspace.name}
        </Link>
      </TableCell>
      <TableCell>
        <WorkspaceKindBadge kind={workspace.kind} />
      </TableCell>
      <TableCell className="font-mono tabular-nums">
        {workspace.gln ?? <span className="text-muted-foreground font-sans">{t('noGln')}</span>}
      </TableCell>
      <TableCell className="tabular-nums">{format.number(workspace.memberCount)}</TableCell>
      <TableCell>{workspace.seeded ? t('seeded.yes') : t('seeded.no')}</TableCell>
      <TableCell className="tabular-nums">
        {format.dateTime(new Date(workspace.createdAt), { dateStyle: 'medium' })}
      </TableCell>
    </TableRow>
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
      <HugeiconsIcon icon={Add01Icon} strokeWidth={2} aria-hidden />
      {t('new')}
    </Button>
  )
}

export function WorkspacesScreen() {
  const t = useTranslations('Operator.workspaces')
  const workspaces = useQuery(operatorWorkspacesQuery)
  const createButton = useRef<HTMLButtonElement>(null)
  const [dialog, setDialog] = useState({ open: false, run: 0 })
  const [created, setCreated] = useState<WorkspaceSummary | null>(null)

  function openDialog() {
    setDialog((current) => ({ open: true, run: current.run + 1 }))
  }

  function closeDialog() {
    setDialog((current) => ({ ...current, open: false }))
  }

  return (
    <ListScreen
      action={<CreateWorkspaceButton ref={createButton} onClick={openDialog} />}
      subtitle={t('subtitle')}
      title={t('title')}>
      <div role="status">
        {created && (
          <p className="rounded-lg border border-emerald-700/40 bg-emerald-500/10 p-3 text-sm">
            {t('created', { name: created.name })}{' '}
            <Link href={`/operator/workspaces/${created.id}`} className={linkClass}>
              {t('open', { name: created.name })}
            </Link>
          </p>
        )}
      </div>
      <ListTable
        columns={columns.map((key) => ({ key, label: t(`columns.${key}`) }))}
        emptyAction={<CreateWorkspaceButton onClick={openDialog} />}
        emptyIcon={Building03Icon}
        matches={(workspace, term) =>
          workspace.name.toLocaleLowerCase().includes(term) ||
          (workspace.gln?.includes(term) ?? false)
        }
        pending={false}
        query={workspaces}
        row={(workspace) => <WorkspaceRow key={workspace.id} workspace={workspace} />}
        t={t}
      />
      <CreateWorkspaceDialog
        key={dialog.run}
        finalFocus={createButton}
        open={dialog.open}
        onCreated={(workspace) => {
          setCreated(workspace)
          closeDialog()
        }}
        onOpenChange={(open) => !open && closeDialog()}
      />
    </ListScreen>
  )
}
