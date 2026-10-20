import { useLocale } from 'next-intl'

import { parseLocale } from '@/i18n/locales'

import type { Language } from '@edi-bridge/contracts'

export function useLanguage(): Language {
  return parseLocale(useLocale())
}
