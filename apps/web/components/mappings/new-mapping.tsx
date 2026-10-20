'use client'

import { AiMagicIcon, ArrowRight02Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { type Ref, useId, useRef, useState } from 'react'

import {
  CreateMappingError,
  NoDocumentStructure,
  useCreateMappingWithDraft,
} from '@/components/mappings/create-mapping-with-draft'
import { DirectionHint } from '@/components/mappings/direction-path'
import { usePlainNames } from '@/components/plain-names'
import { documentStructuresQuery } from '@/lib/api/queries'
import {
  type CreateMappingBody,
  type Direction,
  directionOf,
  type DocumentStructureSummary,
  newMappingMessageTypes,
} from '@edi-bridge/contracts'
import { Alert, AlertDescription } from '@edi-bridge/ui/components/alert'
import { Badge } from '@edi-bridge/ui/components/badge'
import { Button } from '@edi-bridge/ui/components/button'
import { Field, FieldDescription, FieldError, FieldLabel } from '@edi-bridge/ui/components/field'
import { NativeSelect, NativeSelectOption } from '@edi-bridge/ui/components/native-select'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@edi-bridge/ui/components/sheet'
import { Skeleton } from '@edi-bridge/ui/components/skeleton'
import { Spinner } from '@edi-bridge/ui/components/spinner'
import { cn } from '@edi-bridge/ui/lib/utils'

type NewMessageType = CreateMappingBody['messageType']

function Choice({
  messageType,
  locked,
  chosen,
  onChoose,
}: {
  messageType: NewMessageType
  locked: boolean
  chosen: boolean
  onChoose: () => void
}) {
  const t = useTranslations('Mappings.new')
  const tCreate = useTranslations('Mappings.create')
  const plainNames = usePlainNames()
  const pathId = useId()
  const direction = directionOf({ messageType })

  return (
    <li
      className="bg-card not-data-locked:has-[button:hover]:border-primary not-data-locked:has-[button:hover]:bg-primary/5 has-[button:focus-visible]:ring-ring/50 has-[button:focus-visible]:border-ring data-chosen:border-primary relative flex h-full flex-col gap-2 rounded-lg border p-4 transition-colors has-[button:focus-visible]:ring-3"
      data-chosen={chosen || undefined}
      data-locked={locked || undefined}>
      <span id={pathId}>
        <DirectionHint direction={direction} />
      </span>
      <button
        type="button"
        aria-describedby={pathId}
        aria-disabled={locked || undefined}
        className="flex items-center justify-between gap-2 text-left font-medium outline-none after:absolute after:inset-0 after:rounded-lg aria-disabled:cursor-progress"
        onClick={onChoose}>
        {t('choice', { documents: plainNames.messageTypeName(messageType, true), direction })}
        <HugeiconsIcon icon={ArrowRight02Icon} strokeWidth={2} aria-hidden className="size-4" />
      </button>
      {chosen ? (
        <p role="status" className="text-muted-foreground mt-auto flex items-center gap-2 text-xs">
          <Spinner role="presentation" aria-hidden className="size-3.5" />
          {tCreate('creating')}
        </p>
      ) : (
        <Badge variant="secondary" className="mt-auto">
          <HugeiconsIcon icon={AiMagicIcon} strokeWidth={2} aria-hidden />
          {t('aiHint')}
        </Badge>
      )}
    </li>
  )
}

function DocumentStructurePicker({
  documentStructures,
  value,
  missing,
  selectRef,
  onChange,
}: {
  documentStructures: ReadonlyArray<DocumentStructureSummary>
  value: string
  missing: boolean
  selectRef: Ref<HTMLSelectElement>
  onChange: (id: string) => void
}) {
  const t = useTranslations('Mappings.new.documentStructure')
  const id = useId()

  return (
    <Field data-invalid={missing || undefined}>
      <FieldLabel htmlFor={id}>{t('label')}</FieldLabel>
      <NativeSelect
        id={id}
        ref={selectRef}
        value={value}
        aria-describedby={missing ? `${id}-error ${id}-description` : `${id}-description`}
        aria-invalid={missing || undefined}
        className="w-full"
        onChange={(event) => onChange(event.target.value)}>
        {documentStructures.length > 1 && (
          <NativeSelectOption disabled value="">
            {t('placeholder')}
          </NativeSelectOption>
        )}
        {documentStructures.map((documentStructure) => (
          <NativeSelectOption key={documentStructure.id} value={documentStructure.id}>
            {documentStructure.name}
          </NativeSelectOption>
        ))}
      </NativeSelect>
      {missing && <FieldError id={`${id}-error`}>{t('missing')}</FieldError>}
      <FieldDescription id={`${id}-description`}>{t('description')}</FieldDescription>
    </Field>
  )
}

function DocumentStructuresUnavailable({ onRetry }: { onRetry: () => void }) {
  const t = useTranslations('Mappings.new.documentStructure')

  return (
    <Alert variant="destructive">
      <AlertDescription className="flex flex-col items-start gap-2">
        {t('failed')}
        <Button size="sm" variant="outline" onClick={onRetry}>
          {t('retry')}
        </Button>
      </AlertDescription>
    </Alert>
  )
}

export function NewMappingChoices({
  direction,
  className,
}: {
  direction: Direction | null
  className?: string
}) {
  const t = useTranslations('Mappings.new.documentStructure')
  const create = useCreateMappingWithDraft()
  const documentStructures = useQuery(documentStructuresQuery)
  const selectRef = useRef<HTMLSelectElement>(null)
  const [chosenId, setChosenId] = useState('')
  const [missing, setMissing] = useState(false)

  const available = documentStructures.data ?? []
  const chosen = available.some(({ id }) => id === chosenId) ? chosenId : ''
  const documentStructureId = available.length === 1 ? (available[0]?.id ?? '') : chosen

  if (documentStructures.isError) {
    return <DocumentStructuresUnavailable onRetry={() => void documentStructures.refetch()} />
  }

  if (documentStructures.isSuccess && available.length === 0) {
    return <NoDocumentStructure />
  }

  const shown = newMappingMessageTypes.filter(
    (messageType) => !direction || directionOf({ messageType }) === direction,
  )

  function choose(messageType: NewMessageType) {
    if (documentStructures.isPending) {
      return
    }

    if (!documentStructureId) {
      setMissing(true)
      selectRef.current?.focus()

      return
    }

    create.start({ messageType, documentStructureId })
  }

  return (
    <div className="flex flex-col gap-3">
      {documentStructures.isPending ? (
        <div className="flex flex-col gap-2">
          <p role="status" className="sr-only">
            {t('loading')}
          </p>
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-8 w-full" />
        </div>
      ) : (
        <DocumentStructurePicker
          documentStructures={available}
          missing={missing && !documentStructureId}
          selectRef={selectRef}
          value={documentStructureId}
          onChange={(id) => {
            setChosenId(id)
            setMissing(false)
          }}
        />
      )}
      <ul className={cn('grid gap-2', className)}>
        {shown.map((messageType) => (
          <Choice
            key={messageType}
            chosen={create.locked && create.messageType === messageType}
            locked={create.locked || documentStructures.isPending}
            messageType={messageType}
            onChoose={() => choose(messageType)}
          />
        ))}
      </ul>
      <CreateMappingError
        documentStructureNamed={create.documentStructureNamed}
        error={create.error}
      />
    </div>
  )
}

export function NewMappingSheet({
  open,
  direction,
  onOpenChange,
}: {
  open: boolean
  direction: Direction | null
  onOpenChange: (open: boolean) => void
}) {
  const t = useTranslations('Mappings.new')

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent closeLabel={t('close')} className="sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{t('title')}</SheetTitle>
          <SheetDescription>{t('description')}</SheetDescription>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto px-4 pb-4">
          <NewMappingChoices direction={direction} />
        </div>
      </SheetContent>
    </Sheet>
  )
}
