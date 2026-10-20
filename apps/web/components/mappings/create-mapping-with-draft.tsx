'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useRef } from 'react'

import { aiDraftStartHref } from '@/components/mappings/ai-draft-run'
import { createMapping } from '@/lib/api/client'
import { documentStructureKeys, storeCreatedMapping } from '@/lib/api/queries'
import { isMissingDocumentStructure } from '@/lib/document-structures'
import { newDocumentStructureHref } from '@/lib/navigation'
import { Alert, AlertDescription } from '@edi-bridge/ui/components/alert'
import { buttonVariants } from '@edi-bridge/ui/components/button'
import { cn } from '@edi-bridge/ui/lib/utils'

import type { CreateMappingBody } from '@edi-bridge/contracts'

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
    onError: (error) => {
      started.current = false

      if (isMissingDocumentStructure(error)) {
        void queryClient.invalidateQueries({ queryKey: documentStructureKeys.all() })
      }
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

export function NoDocumentStructure() {
  const t = useTranslations('Mappings.create')

  return (
    <Alert role="note" className="text-left">
      <AlertDescription className="flex flex-col items-start gap-2">
        {t('noDocumentStructure')}
        <Link
          href={newDocumentStructureHref}
          className={buttonVariants({ variant: 'outline', size: 'sm' })}>
          {t('addDataFormat')}
        </Link>
      </AlertDescription>
    </Alert>
  )
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

  return (
    <Alert variant="destructive" className={cn('text-left', className)}>
      <AlertDescription>
        {isMissingDocumentStructure(error) ? t('documentStructureGone') : t('failed')}
      </AlertDescription>
    </Alert>
  )
}
