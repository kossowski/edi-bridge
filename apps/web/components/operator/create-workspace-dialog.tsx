'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { type FormEvent, type RefObject, useId, useRef, useState } from 'react'

import { TextField } from '@/components/form-field'
import { ApiError, createWorkspace } from '@/lib/api/client'
import { storeCreatedWorkspace } from '@/lib/api/queries'
import { sameWorkspaceName, validateWorkspaceForm } from '@/lib/forms/operator'
import { maxWorkspaceNameLength, type WorkspaceSummary } from '@edi-bridge/contracts'
import { Button } from '@edi-bridge/ui/components/button'
import { Checkbox } from '@edi-bridge/ui/components/checkbox'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@edi-bridge/ui/components/dialog'

function CreateWorkspaceForm({ onCreated }: { onCreated: (created: WorkspaceSummary) => void }) {
  const t = useTranslations('Operator.createWorkspace')
  const queryClient = useQueryClient()
  const id = useId()
  const nameInput = useRef<HTMLInputElement>(null)
  const [name, setName] = useState('')
  const [seed, setSeed] = useState(true)
  const [submitted, setSubmitted] = useState(false)
  const [taken, setTaken] = useState<string | null>(null)

  const create = useMutation({
    mutationFn: createWorkspace,
    onSuccess: (created) => {
      storeCreatedWorkspace(queryClient, created)
      onCreated(created)
    },
    onError: (error, input) => {
      if (error instanceof ApiError && error.status === 409) {
        setTaken(input.name)
        nameInput.current?.focus()
      }
    },
  })

  const result = validateWorkspaceForm({ name, seed })

  const nameError =
    submitted && 'error' in result
      ? t(`errors.${result.error}`, { max: maxWorkspaceNameLength })
      : taken !== null && sameWorkspaceName(name, taken)
        ? t('errors.taken')
        : null

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (create.isPending) {
      return
    }

    setSubmitted(true)

    if ('error' in result) {
      nameInput.current?.focus()

      return
    }

    create.mutate(result.input)
  }

  return (
    <form noValidate aria-busy={create.isPending} className="flex flex-col gap-4" onSubmit={submit}>
      <TextField
        id={`${id}-name`}
        autoComplete="organization"
        description={t('name.description', { max: maxWorkspaceNameLength })}
        error={nameError}
        label={t('name.label')}
        name="name"
        ref={nameInput}
        value={name}
        onChange={setName}
      />
      <div className="flex flex-col gap-1.5">
        <label className="flex w-fit cursor-pointer items-center gap-2 text-sm font-medium">
          <Checkbox
            checked={seed}
            aria-describedby={`${id}-seed-description`}
            onCheckedChange={setSeed}
          />
          {t('seed.label')}
        </label>
        <p id={`${id}-seed-description`} className="text-muted-foreground text-sm">
          {t('seed.description')}
        </p>
      </div>
      {create.isError && !(create.error instanceof ApiError && create.error.status === 409) && (
        <p role="alert" className="text-sm text-red-800 dark:text-red-300">
          {t('errors.failed')}
        </p>
      )}
      <DialogFooter>
        <DialogClose render={<Button variant="outline" />}>{t('cancel')}</DialogClose>
        <Button
          type="submit"
          aria-disabled={create.isPending || undefined}
          className="aria-disabled:cursor-progress aria-disabled:opacity-50">
          {create.isPending ? t('creating') : t('create')}
        </Button>
      </DialogFooter>
    </form>
  )
}

export function CreateWorkspaceDialog({
  open,
  finalFocus,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  finalFocus: RefObject<HTMLElement | null>
  onOpenChange: (open: boolean) => void
  onCreated: (created: WorkspaceSummary) => void
}) {
  const t = useTranslations('Operator.createWorkspace')

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t('close')} finalFocus={finalFocus} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        <CreateWorkspaceForm onCreated={onCreated} />
      </DialogContent>
    </Dialog>
  )
}
