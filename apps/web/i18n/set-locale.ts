'use server'

import { cookies } from 'next/headers'

import { localeCookieName, parseLocale } from './locales'

const ONE_YEAR_IN_SECONDS = 60 * 60 * 24 * 365

export async function setLocale(value: string) {
  const cookieStore = await cookies()

  cookieStore.set(localeCookieName, parseLocale(value), {
    maxAge: ONE_YEAR_IN_SECONDS,
    sameSite: 'lax',
  })
}
