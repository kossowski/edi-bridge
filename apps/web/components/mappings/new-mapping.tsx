'use client'

import { AiMagicIcon, ArrowRight02Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useId } from 'react'

import { aiDraftStartHref } from '@/components/mappings/ai-draft-run'
import { DirectionHint } from '@/components/mappings/direction-path'
import { usePlainNames } from '@/components/plain-names'
import { ApiError, createMapping } from '@/lib/api/client'
import { storeCreatedMapping } from '@/lib/api/queries'
import {
  type CreateMappingBody,
  type Direction,
  directionOf,
  newMappingMessageTypes,
} from '@edi-bridge/contracts'
import { Alert, AlertDescription } from '@edi-bridge/ui/components/alert'
import { Badge } from '@edi-bridge/ui/components/badge'
import { buttonVariants } from '@edi-bridge/ui/components/button'
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
  const plainNames = usePlainNames()
  const pathId = useId()
  const direction = directionOf({ messageType })

  return (
    <li
      className="bg-card has-[button:hover:enabled]:border-primary has-[button:hover:enabled]:bg-primary/5 has-[button:focus-visible]:ring-ring/50 has-[button:focus-visible]:border-ring data-chosen:border-primary relative flex h-full flex-col gap-2 rounded-lg border p-4 transition-colors has-[button:focus-visible]:ring-3"
      data-chosen={chosen || undefined}>
      <span id={pathId}>
        <DirectionHint direction={direction} />
      </span>
      <button
        disabled={locked}
        type="button"
        aria-describedby={pathId}
        className="flex items-center justify-between gap-2 text-left font-medium outline-none after:absolute after:inset-0 after:rounded-lg disabled:cursor-not-allowed"
        onClick={onChoose}>
        {t('choice', { documents: plainNames.messageTypeName(messageType, true), direction })}
        <HugeiconsIcon icon={ArrowRight02Icon} strokeWidth={2} aria-hidden className="size-4" />
      </button>
      {chosen ? (
        <p role="status" className="text-muted-foreground mt-auto flex items-center gap-2 text-xs">
          <Spinner role="presentation" aria-hidden className="size-3.5" />
          {t('creating')}
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
  const t = useTranslations('Mappings.new')
  const router = useRouter()
  const queryClient = useQueryClient()

  const create = useMutation({
    mutationFn: createMapping,
    onSuccess: (created) => {
      storeCreatedMapping(queryClient, created)
      router.push(aiDraftStartHref(created.id))
    },
  })

  const locked = create.isPending || create.isSuccess
  const noDocumentStructure = create.error instanceof ApiError && create.error.status === 422

  const shown = newMappingMessageTypes.filter(
    (messageType) => !direction || directionOf({ messageType }) === direction,
  )

  return (
    <div className="flex flex-col gap-3">
      <ul className={cn('grid gap-2', className)}>
        {shown.map((messageType) => (
          <Choice
            key={messageType}
            chosen={locked && create.variables?.messageType === messageType}
            locked={locked}
            messageType={messageType}
            onChoose={() => create.mutate({ messageType })}
          />
        ))}
      </ul>
      {create.isError && (
        <Alert variant="destructive">
          <AlertDescription className="flex flex-col items-start gap-2">
            {noDocumentStructure ? t('noDocumentStructure') : t('failed')}
            {noDocumentStructure && (
              <Link
                href="/document-structures/new"
                className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                {t('addDataFormat')}
              </Link>
            )}
          </AlertDescription>
        </Alert>
      )}
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
