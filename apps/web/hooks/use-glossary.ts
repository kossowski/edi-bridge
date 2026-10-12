'use client'

import { useTranslations } from 'next-intl'

import { usePlainNames } from '@/components/plain-names'
import { type GlossaryEntry } from '@/lib/glossary'

export function useGlossary() {
  const t = useTranslations('Help')
  const plainNames = usePlainNames()

  return (entry: GlossaryEntry) =>
    entry.kind === 'messageType'
      ? {
          label: plainNames.messageTypeName(entry.key),
          explanation: t(`messageTypes.${entry.key}`),
        }
      : {
          label: t(`terms.${entry.key}.label`),
          explanation: t(`terms.${entry.key}.explanation`),
        }
}
