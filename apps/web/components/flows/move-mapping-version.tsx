'use client'

import { ArrowUp02Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { useEffect, useId, useRef, useState } from 'react'

import { useVersionOptionLabel } from '@/components/flows/flow-parts'
import { moveFlowMappingVersion } from '@/lib/api/client'
import { storeSavedFlow } from '@/lib/api/queries'
import { Button } from '@edi-bridge/ui/components/button'
import { RadioGroup, RadioGroupItem } from '@edi-bridge/ui/components/radio-group'

import type { Flow } from '@edi-bridge/contracts'

export function MoveMappingVersion({
  flow,
  onMoved,
}: {
  flow: Flow
  onMoved: (version: number) => void
}) {
  const t = useTranslations('Flow.move')
  const optionLabel = useVersionOptionLabel()
  const queryClient = useQueryClient()
  const id = useId()
  const newest = flow.newerMappingVersions[0]
  const [chosenId, setChosenId] = useState<string | null>(null)
  const toggled = useRef(false)
  const button = useRef<HTMLButtonElement>(null)
  const confirmation = useRef<HTMLParagraphElement>(null)
  const confirming = chosenId !== null

  useEffect(() => {
    if (toggled.current) {
      ;(confirming ? confirmation : button).current?.focus()
    }
  }, [confirming])

  const move = useMutation({
    mutationFn: (mappingVersionId: string) => moveFlowMappingVersion(flow.id, { mappingVersionId }),
    onSuccess: (moved) => {
      storeSavedFlow(queryClient, moved)
      toggled.current = false
      setChosenId(null)
      onMoved(moved.mappingVersion.version)
    },
  })

  if (!newest) {
    return null
  }

  function toggle(next: string | null) {
    toggled.current = true
    move.reset()
    setChosenId(next)
  }

  if (!confirming) {
    return (
      <Button ref={button} variant="outline" className="w-fit" onClick={() => toggle(newest.id)}>
        <HugeiconsIcon icon={ArrowUp02Icon} strokeWidth={2} aria-hidden />
        {t('button')}
      </Button>
    )
  }

  const chosen = flow.newerMappingVersions.find(({ id: versionId }) => versionId === chosenId)

  return (
    <div
      role="group"
      aria-labelledby={`${id}-confirmation`}
      className="flex flex-col gap-4 rounded-lg border border-amber-600/40 bg-amber-500/10 p-3">
      <p
        id={`${id}-confirmation`}
        ref={confirmation}
        tabIndex={-1}
        className="text-sm outline-none">
        {t('confirmation')}
      </p>
      <div className="flex flex-col gap-2">
        <span id={`${id}-legend`} className="text-sm font-medium">
          {t('legend')}
        </span>
        <RadioGroup
          value={chosenId}
          aria-labelledby={`${id}-legend`}
          className="flex flex-col gap-2"
          onValueChange={(next) => {
            const version = flow.newerMappingVersions.find(
              ({ id: versionId }) => versionId === next,
            )

            if (version) {
              setChosenId(version.id)
            }
          }}>
          {flow.newerMappingVersions.map((version) => (
            <label
              key={version.id}
              className="flex w-fit cursor-pointer items-center gap-2 text-sm">
              <RadioGroupItem value={version.id} />
              {optionLabel(version)}
            </label>
          ))}
        </RadioGroup>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={move.isPending || !chosen}
          onClick={() => chosen && move.mutate(chosen.id)}>
          {move.isPending ? t('pending') : t('confirm', { version: chosen?.version ?? '' })}
        </Button>
        <Button disabled={move.isPending} variant="outline" onClick={() => toggle(null)}>
          {t('cancel')}
        </Button>
      </div>
      {move.isError && (
        <p role="alert" className="text-sm text-red-800 dark:text-red-300">
          {t('failed')}
        </p>
      )}
    </div>
  )
}
