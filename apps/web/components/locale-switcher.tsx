'use client'

import { LanguageSkillIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useLocale, useTranslations } from 'next-intl'
import { useTransition } from 'react'

import { locales } from '@/i18n/locales'
import { setLocale } from '@/i18n/set-locale'
import { Button } from '@edi-bridge/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@edi-bridge/ui/components/dropdown-menu'

export function LocaleSwitcher() {
  const t = useTranslations('Shell.language')
  const locale = useLocale()
  const [isPending, startTransition] = useTransition()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={isPending}
        render={<Button size="icon" title={t('label')} variant="ghost" aria-label={t('label')} />}>
        <HugeiconsIcon icon={LanguageSkillIcon} strokeWidth={2} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t('label')}</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={locale}
            onValueChange={(value: string) => startTransition(() => setLocale(value))}>
            {locales.map((option) => (
              <DropdownMenuRadioItem key={option} lang={option} value={option}>
                {t(option)}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
