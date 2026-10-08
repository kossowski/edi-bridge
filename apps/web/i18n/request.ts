import { getRequestConfig } from 'next-intl/server'
import { cookies } from 'next/headers'

import { localeCookieName, parseLocale } from './locales'

const loadMessages = {
  en: () => import('../messages/en.json'),
  de: () => import('../messages/de.json'),
}

export default getRequestConfig(async () => {
  const cookieStore = await cookies()
  const locale = parseLocale(cookieStore.get(localeCookieName)?.value)
  const { default: messages } = await loadMessages[locale]()

  return { locale, messages }
})
