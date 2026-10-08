export const locales = ['en', 'de'] as const

export type Locale = (typeof locales)[number]

export const defaultLocale: Locale = 'en'

export const localeCookieName = 'NEXT_LOCALE'

export function parseLocale(value: string | undefined): Locale {
  return locales.find((locale) => locale === value) ?? defaultLocale
}
