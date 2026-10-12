'use client'

import { AiMagicIcon, Link01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useTranslations } from 'next-intl'
import { useId } from 'react'

import { useSideTitle } from '@/components/mappings/mapping-side'
import { Badge } from '@edi-bridge/ui/components/badge'
import { Button } from '@edi-bridge/ui/components/button'

import type { MappingDraft } from '@edi-bridge/contracts'

const steps = ['step1', 'step2', 'step3'] as const

export function StartHere({
  draft,
  onAiDraft,
  onLinkYourself,
}: {
  draft: MappingDraft
  onAiDraft: () => void
  onLinkYourself: () => void
}) {
  const t = useTranslations('Mapping.startHere')
  const sideTitle = useSideTitle()
  const titleId = useId()

  return (
    <section
      aria-labelledby={titleId}
      className="border-primary/40 bg-card mx-auto flex w-full max-w-3xl flex-col gap-4 rounded-lg border p-6">
      <div className="flex flex-col gap-1">
        <h2 id={titleId} className="font-heading text-lg font-medium">
          {t('title')}
        </h2>
        <p className="text-muted-foreground text-sm">
          {t('description', { source: sideTitle(draft.source), target: sideTitle(draft.target) })}
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="bg-background border-primary flex flex-col gap-3 rounded-lg border p-4">
          <div className="flex flex-wrap items-center gap-2">
            <HugeiconsIcon
              icon={AiMagicIcon}
              strokeWidth={2}
              aria-hidden
              className="text-primary size-5"
            />
            <h3 className="font-medium">{t('ai.title')}</h3>
            <Badge>{t('ai.recommended')}</Badge>
          </div>
          <p className="text-muted-foreground text-sm">{t('ai.description')}</p>
          <Button className="mt-auto self-start" onClick={onAiDraft}>
            <HugeiconsIcon icon={AiMagicIcon} strokeWidth={2} aria-hidden />
            {t('ai.button')}
          </Button>
        </div>
        <div className="bg-background flex flex-col gap-3 rounded-lg border p-4">
          <div className="flex items-center gap-2">
            <HugeiconsIcon icon={Link01Icon} strokeWidth={2} aria-hidden className="size-5" />
            <h3 className="font-medium">{t('manual.title')}</h3>
          </div>
          <ol className="text-muted-foreground list-decimal space-y-1 ps-5 text-sm">
            {steps.map((step) => (
              <li key={step}>{t(`manual.${step}`)}</li>
            ))}
          </ol>
          <Button variant="outline" className="mt-auto self-start" onClick={onLinkYourself}>
            {t('manual.button')}
          </Button>
        </div>
      </div>
    </section>
  )
}
