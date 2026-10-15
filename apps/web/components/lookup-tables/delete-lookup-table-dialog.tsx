'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'

import type { RefObject } from 'react'

import { ApiError, deleteLookupTable } from '@/lib/api/client'
import { forgetDeletedLookupTable, lookupTableKeys } from '@/lib/api/queries'
import { lookupTableInUseStatus, type LookupTableSummary } from '@edi-bridge/contracts'
import { Button } from '@edi-bridge/ui/components/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@edi-bridge/ui/components/dialog'

function isInUse(error: Error | null) {
  return error instanceof ApiError && error.status === lookupTableInUseStatus
}

function DeleteConfirmation({
  table,
  onDeleted,
}: {
  table: LookupTableSummary
  onDeleted: (table: LookupTableSummary) => void
}) {
  const t = useTranslations('LookupTables.delete')
  const queryClient = useQueryClient()

  const remove = useMutation({
    mutationFn: async () => {
      try {
        await deleteLookupTable(table.id)
      } catch (error) {
        if (!(error instanceof ApiError && error.status === 404)) {
          throw error
        }
      }
    },
    onSuccess: () => {
      forgetDeletedLookupTable(queryClient, table.id)
      onDeleted(table)
    },
    onError: (error) => {
      if (isInUse(error)) {
        void queryClient.invalidateQueries({ queryKey: lookupTableKeys.list() })
      }
    },
  })

  const inUse = isInUse(remove.error)

  return (
    <>
      {remove.isError && (
        <p role="alert" className="text-sm text-red-800 dark:text-red-300">
          {inUse ? t('inUse') : t('failed')}
        </p>
      )}
      <DialogFooter>
        <DialogClose disabled={remove.isPending} render={<Button variant="outline" />}>
          {t('cancel')}
        </DialogClose>
        <Button
          disabled={remove.isPending || inUse}
          focusableWhenDisabled
          variant="destructive"
          onClick={() => remove.mutate()}>
          {remove.isPending ? t('pending') : t('confirm')}
        </Button>
      </DialogFooter>
    </>
  )
}

export function DeleteLookupTableDialog({
  open,
  table,
  finalFocus,
  onOpenChange,
  onDeleted,
}: {
  open: boolean
  table: LookupTableSummary | null
  finalFocus: RefObject<HTMLElement | null>
  onOpenChange: (open: boolean) => void
  onDeleted: (table: LookupTableSummary) => void
}) {
  const t = useTranslations('LookupTables.delete')

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t('close')} finalFocus={finalFocus}>
        {table && (
          <>
            <DialogHeader>
              <DialogTitle>{t('title', { name: table.name })}</DialogTitle>
              <DialogDescription>{t('description', { count: table.entryCount })}</DialogDescription>
            </DialogHeader>
            <DeleteConfirmation key={table.id} table={table} onDeleted={onDeleted} />
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
