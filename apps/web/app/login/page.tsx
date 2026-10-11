import { HugeiconsIcon } from '@hugeicons/react'
import { getTranslations } from 'next-intl/server'

import type { Metadata } from 'next'

import { LocaleSwitcher } from '@/components/locale-switcher'
import { LoginScreen } from '@/components/session/login-screen'
import { ThemeSwitcher } from '@/components/theme-switcher'
import { appIcon } from '@/lib/navigation'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations()

  return { title: { absolute: `${t('Login.metaTitle')} · ${t('Shell.appName')}` } }
}

export default async function Page() {
  const t = await getTranslations('Shell')

  return (
    <div className="flex min-h-svh flex-col">
      <header className="flex h-14 shrink-0 items-center gap-2 px-4">
        <div className="flex items-center gap-2 font-semibold">
          <HugeiconsIcon icon={appIcon} strokeWidth={2} className="size-4 shrink-0" />
          {t('appName')}
        </div>
        <div className="ml-auto flex items-center gap-1">
          <LocaleSwitcher />
          <ThemeSwitcher />
        </div>
      </header>
      <main
        id="main-content"
        tabIndex={-1}
        className="flex flex-1 items-center justify-center px-4 py-12 outline-none">
        <LoginScreen />
      </main>
    </div>
  )
}
