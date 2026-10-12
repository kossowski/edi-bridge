'use client'

import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { type ReactNode, useId } from 'react'

import { useGlossary } from '@/hooks/use-glossary'
import { type GlossaryKey, glossaryEntry, helpHref } from '@/lib/glossary'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@edi-bridge/ui/components/hover-card'

export function Term({
  glossaryKey,
  children,
}: {
  glossaryKey: GlossaryKey
  children?: ReactNode
}) {
  const t = useTranslations('Help')
  const glossary = useGlossary()
  const descriptionId = useId()
  const entry = glossaryEntry(glossaryKey)
  const { label, explanation } = glossary(entry)

  return (
    <HoverCard>
      <HoverCardTrigger
        render={<Link href={helpHref(glossaryKey)} />}
        aria-describedby={descriptionId}
        className="decoration-muted-foreground/60 hover:decoration-foreground data-popup-open:decoration-foreground focus-visible:ring-ring/50 cursor-help rounded-sm underline decoration-dotted underline-offset-4 outline-none focus-visible:ring-[3px]">
        {children ?? label}
      </HoverCardTrigger>
      <span id={descriptionId} hidden>
        {explanation} {t('technicalTerm')}: {entry.term}
      </span>
      <HoverCardContent className="flex w-72 flex-col gap-1.5">
        <p className="font-medium">{label}</p>
        <p>{explanation}</p>
        <p className="text-muted-foreground text-xs">
          {t('technicalTerm')}: <span lang="en">{entry.term}</span>
        </p>
      </HoverCardContent>
    </HoverCard>
  )
}
