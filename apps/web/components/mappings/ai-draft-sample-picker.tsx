'use client'

import { RefreshIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { type RefObject, useId } from 'react'

import { chosenSampleId } from '@/components/mappings/ai-draft-run'
import { mappingSamplesQuery } from '@/lib/api/queries'
import { Button } from '@edi-bridge/ui/components/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@edi-bridge/ui/components/select'
import { Skeleton } from '@edi-bridge/ui/components/skeleton'

export function AiDraftSamplePicker({
  mappingId,
  chosen,
  onChoose,
  noticeId,
  triggerRef,
}: {
  mappingId: string
  chosen: string | null
  onChoose: (id: string) => void
  noticeId: string
  triggerRef: RefObject<HTMLButtonElement | null>
}) {
  const t = useTranslations('Mapping.aiDraft.samples')
  const samples = useQuery(mappingSamplesQuery(mappingId))
  const labelId = useId()

  if (samples.isPending) {
    return (
      <div className="flex flex-col gap-1.5">
        <span role="status" className="sr-only">
          {t('loading')}
        </span>
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-8 w-full" />
      </div>
    )
  }

  if (samples.isError) {
    return (
      <p id={noticeId} className="flex flex-wrap items-center gap-2 text-red-800 dark:text-red-300">
        {t('error')}
        <Button size="sm" variant="outline" onClick={() => void samples.refetch()}>
          <HugeiconsIcon icon={RefreshIcon} strokeWidth={2} aria-hidden />
          {t('retry')}
        </Button>
      </p>
    )
  }

  if (samples.data.length === 0) {
    return (
      <p id={noticeId} className="text-muted-foreground">
        {t('empty')}
      </p>
    )
  }

  const items = samples.data.map(({ id, name }) => ({ value: id, label: name }))

  return (
    <div className="flex flex-col gap-1.5">
      <span id={labelId} className="font-medium">
        {t('label')}
      </span>
      <Select
        items={items}
        value={chosenSampleId(chosen, samples.data)}
        onValueChange={(next) => next && onChoose(next)}>
        <SelectTrigger ref={triggerRef} aria-labelledby={labelId} className="w-full">
          <SelectValue className="min-w-0">
            {(selected: string | null) => (
              <span className="truncate">
                {items.find((item) => item.value === selected)?.label}
              </span>
            )}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
