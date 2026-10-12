'use client'

import { Add01Icon, Building03Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { type Ref, useRef, useState } from 'react'

import { AppPage } from '@/components/app-page'
import { linkClass, rowLinkClass } from '@/components/detail-parts'
import { ListTable } from '@/components/list-table'
import { CreateWorkspaceDialog } from '@/components/operator/create-workspace-dialog'
import { WorkspaceKindBadge } from '@/components/operator/workspace-kind-badge'
import {
  WorkspaceCreatedAt,
  WorkspaceGln,
  WorkspaceMembers,
  WorkspaceSeeded,
} from '@/components/operator/workspace-values'
import { operatorWorkspacesQuery } from '@/lib/api/queries'
import { Alert, AlertDescription } from '@edi-bridge/ui/components/alert'
import { Button } from '@edi-bridge/ui/components/button'
import { TableCell, TableRow } from '@edi-bridge/ui/components/table'

import type { WorkspaceSummary } from '@edi-bridge/contracts'

const columns = ['name', 'kind', 'gln', 'members', 'seeded', 'createdAt'] as const

function WorkspaceRow({ workspace }: { workspace: WorkspaceSummary }) {
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
      <TableCell>
        <WorkspaceGln gln={workspace.gln} />
      </TableCell>
      <TableCell>
        <WorkspaceMembers count={workspace.memberCount} />
      </TableCell>
      <TableCell>
        <WorkspaceSeeded seeded={workspace.seeded} />
      </TableCell>
      <TableCell>
        <WorkspaceCreatedAt createdAt={workspace.createdAt} />
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
  const tSession = useTranslations('Shell.session')
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
    <AppPage
      actions={<CreateWorkspaceButton ref={createButton} onClick={openDialog} />}
      title={tSession('operatorArea')}
      className="gap-4">
      <div role="status">
        {created && (
          <Alert role={undefined} variant="success">
            <AlertDescription>
              {t('created', { name: created.name })}{' '}
              <Link href={`/operator/workspaces/${created.id}`} className={linkClass}>
                {t('open', { name: created.name })}
              </Link>
            </AlertDescription>
          </Alert>
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
    </AppPage>
  )
}
