'use client'

import { Moon02Icon, Sun03Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useTranslations } from 'next-intl'
import { useTheme } from 'next-themes'

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

const themes = ['light', 'dark', 'system'] as const

export function ThemeSwitcher() {
  const t = useTranslations('Shell.theme')
  const { theme, setTheme } = useTheme()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button size="icon" title={t('label')} variant="ghost" aria-label={t('label')} />}>
        <HugeiconsIcon icon={Sun03Icon} strokeWidth={2} className="dark:hidden" />
        <HugeiconsIcon icon={Moon02Icon} strokeWidth={2} className="hidden dark:block" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t('label')}</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={theme ?? 'system'} onValueChange={setTheme}>
            {themes.map((option) => (
              <DropdownMenuRadioItem key={option} value={option}>
                {t(option)}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
