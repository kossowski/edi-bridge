'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { useRef, useState } from 'react'

import { useSession } from '@/hooks/use-session'
import { resetSandboxWorkspace } from '@/lib/api/client'
import { storeResetSandboxWorkspace } from '@/lib/api/queries'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@edi-bridge/ui/components/alert-dialog'
import { Button } from '@edi-bridge/ui/components/button'

import type { WorkspaceSummary } from '@edi-bridge/contracts'

export function SandboxReset({
  workspace,
  onReset,
}: {
  workspace: WorkspaceSummary
  onReset: (reset: WorkspaceSummary) => void
}) {
  const t = useTranslations('Operator.reset')
  const queryClient = useQueryClient()
  const { session } = useSession()
  const trigger = useRef<HTMLButtonElement>(null)
  const cancel = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)

  const reset = useMutation({
    mutationFn: () => resetSandboxWorkspace(workspace.id),
    onSuccess: (summary) => {
      storeResetSandboxWorkspace(queryClient, summary, session?.workspace.id)
      setOpen(false)
      onReset(summary)
    },
  })

  function changeOpen(next: boolean) {
    if (reset.isPending) {
      return
    }

    if (next) {
      reset.reset()
    }

    setOpen(next)
  }

  return (
    <AlertDialog open={open} onOpenChange={changeOpen}>
      <Button ref={trigger} variant="destructive" onClick={() => changeOpen(true)}>
        {t('trigger')}
      </Button>
      <AlertDialogContent
        finalFocus={trigger}
        initialFocus={cancel}
        aria-busy={reset.isPending || undefined}>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('title', { name: workspace.name })}</AlertDialogTitle>
          <AlertDialogDescription render={<div />} className="flex flex-col gap-2">
            <p>{t('replaced')}</p>
            <p>{t('untouched')}</p>
            <p className="text-foreground font-medium">{t('irreversible')}</p>
          </AlertDialogDescription>
        </AlertDialogHeader>
        {reset.isError && (
          <p role="alert" className="text-sm text-red-800 dark:text-red-300">
            {t('failed')}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel ref={cancel}>{t('cancel')}</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            aria-disabled={reset.isPending || undefined}
            className="aria-disabled:cursor-progress aria-disabled:opacity-50"
            onClick={() => {
              if (!reset.isPending) {
                reset.mutate()
              }
            }}>
            {reset.isPending ? t('resetting') : t('confirm')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
