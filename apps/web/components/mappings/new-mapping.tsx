'use client'

import { AiMagicIcon, ArrowRight02Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useTranslations } from 'next-intl'
import { useId } from 'react'

import {
  CreateMappingError,
  useCreateMappingWithDraft,
} from '@/components/mappings/create-mapping-with-draft'
import { DirectionHint } from '@/components/mappings/direction-path'
import { usePlainNames } from '@/components/plain-names'
import {
  type CreateMappingBody,
  type Direction,
  directionOf,
  newMappingMessageTypes,
} from '@edi-bridge/contracts'
import { Badge } from '@edi-bridge/ui/components/badge'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@edi-bridge/ui/components/sheet'
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

export function NewMappingChoices({
  direction,
  className,
}: {
  direction: Direction | null
  className?: string
}) {
  const create = useCreateMappingWithDraft()

  const shown = newMappingMessageTypes.filter(
    (messageType) => !direction || directionOf({ messageType }) === direction,
  )

  return (
    <div className="flex flex-col gap-3">
      <ul className={cn('grid gap-2', className)}>
        {shown.map((messageType) => (
          <Choice
            key={messageType}
            chosen={create.locked && create.messageType === messageType}
            locked={create.locked}
            messageType={messageType}
            onChoose={() => create.start({ messageType })}
          />
        ))}
      </ul>
      <CreateMappingError error={create.error} />
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
