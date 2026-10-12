'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useRef } from 'react'

import { aiDraftStartHref } from '@/components/mappings/ai-draft-run'
import { ApiError, createMapping } from '@/lib/api/client'
import { storeCreatedMapping } from '@/lib/api/queries'
import { newDocumentStructureHref } from '@/lib/navigation'
import { Alert, AlertDescription } from '@edi-bridge/ui/components/alert'
import { buttonVariants } from '@edi-bridge/ui/components/button'
import { cn } from '@edi-bridge/ui/lib/utils'

import type { CreateMappingBody } from '@edi-bridge/contracts'

function isMissingDocumentStructure(error: Error) {
  return error instanceof ApiError && error.status === 422
}

export function useCreateMappingWithDraft() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const started = useRef(false)

  const create = useMutation({
    mutationFn: createMapping,
    onSuccess: (created) => {
      storeCreatedMapping(queryClient, created)
      router.push(aiDraftStartHref(created.id))
    },
    onError: () => {
      started.current = false
    },
  })

  function start(body: CreateMappingBody) {
    if (started.current) {
      return
    }

    started.current = true
    create.mutate(body)
  }

  return {
    start,
    locked: create.isPending || create.isSuccess,
    messageType: create.variables?.messageType,
    error: create.error,
  }
}

export function CreateMappingError({
  error,
  className,
}: {
  error: Error | null
  className?: string
}) {
  const t = useTranslations('Mappings.create')

  if (!error) {
    return null
  }

  const missingDocumentStructure = isMissingDocumentStructure(error)

  return (
    <Alert variant="destructive" className={cn('text-left', className)}>
      <AlertDescription className="flex flex-col items-start gap-2">
        {missingDocumentStructure ? t('noDocumentStructure') : t('failed')}
        {missingDocumentStructure && (
          <Link
            href={newDocumentStructureHref}
            className={buttonVariants({ variant: 'outline', size: 'sm' })}>
            {t('addDataFormat')}
          </Link>
        )}
      </AlertDescription>
    </Alert>
  )
}
