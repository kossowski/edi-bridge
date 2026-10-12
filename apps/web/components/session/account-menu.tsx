'use client'

import {
  ComputerIcon,
  LanguageSkillIcon,
  Logout03Icon,
  Moon02Icon,
  Sun03Icon,
  UnfoldMoreIcon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useLocale, useTranslations } from 'next-intl'
import { useTheme } from 'next-themes'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useTransition } from 'react'

import { focusMainContentOnNextPage } from '@/components/main-content-focus'
import { useSession } from '@/hooks/use-session'
import { locales } from '@/i18n/locales'
import { setLocale } from '@/i18n/set-locale'
import { signOut } from '@/lib/api/client'
import { accountMenuItems } from '@/lib/navigation'
import { Avatar, AvatarFallback } from '@edi-bridge/ui/components/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@edi-bridge/ui/components/dropdown-menu'
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@edi-bridge/ui/components/sidebar'

const systemTheme = { value: 'system', icon: ComputerIcon } as const

const themes = [
  { value: 'light', icon: Sun03Icon },
  { value: 'dark', icon: Moon02Icon },
  systemTheme,
] as const

function initialsOf(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
}

export function AccountMenu() {
  const t = useTranslations('Shell')
  const queryClient = useQueryClient()
  const router = useRouter()
  const locale = useLocale()
  const { theme, setTheme } = useTheme()
  const [localePending, startTransition] = useTransition()
  const { isMobile, setOpenMobile } = useSidebar()
  const { session, unavailable, operator, role } = useSession()

  const signOutMutation = useMutation({
    mutationFn: signOut,
    onSuccess: () => {
      queryClient.clear()
      focusMainContentOnNextPage()
      router.replace('/login')
    },
  })

  if (!session && !unavailable) {
    return null
  }

  const name = session ? session.user.name : t('session.unavailable')

  const roleLabel = [operator && t('session.operator'), role && t(`session.role.${role}`)]
    .filter(Boolean)
    .join(' · ')

  const currentTheme = themes.find((option) => option.value === theme) ?? systemTheme

  return (
    <>
      {signOutMutation.isError && (
        <p
          role="alert"
          className="text-destructive-text px-2 text-sm group-data-[collapsible=icon]:sr-only">
          {t('session.signOutFailed')}
        </p>
      )}
      <SidebarMenu>
        <SidebarMenuItem>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <SidebarMenuButton
                  size="lg"
                  className="data-popup-open:bg-sidebar-accent data-popup-open:text-sidebar-accent-foreground"
                />
              }>
              <Avatar aria-hidden className="size-8 rounded-lg">
                <AvatarFallback className="bg-sidebar-primary text-sidebar-primary-foreground rounded-lg">
                  {session ? initialsOf(session.user.name) : '?'}
                </AvatarFallback>
              </Avatar>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{name}</span>
                {roleLabel && <span className="truncate text-xs">{roleLabel}</span>}
              </div>
              <span className="sr-only">, {t('session.accountMenu')}</span>
              <HugeiconsIcon icon={UnfoldMoreIcon} strokeWidth={2} className="ml-auto size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              side={isMobile ? 'top' : 'right'}
              sideOffset={4}
              className="w-64">
              <DropdownMenuGroup>
                {session ? (
                  <DropdownMenuLabel className="flex flex-col gap-0.5">
                    <span className="text-muted-foreground text-xs">{t('session.signedInAs')}</span>
                    <span className="text-foreground font-medium break-words">
                      {session.user.name}
                    </span>
                    <span className="break-all">{session.user.email}</span>
                    {roleLabel && <span>{roleLabel}</span>}
                    <span>
                      {t('workspace.label')}: {session.workspace.name}
                    </span>
                  </DropdownMenuLabel>
                ) : (
                  <DropdownMenuLabel>{t('session.unavailableDescription')}</DropdownMenuLabel>
                )}
              </DropdownMenuGroup>
              {session && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuGroup>
                    {accountMenuItems(operator).map((item) => (
                      <DropdownMenuItem
                        key={item.key}
                        render={<Link href={item.href} />}
                        onClick={() => setOpenMobile(false)}>
                        <HugeiconsIcon icon={item.icon} strokeWidth={2} />
                        {t(`session.${item.key}`)}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuGroup>
                </>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger disabled={localePending}>
                    <HugeiconsIcon icon={LanguageSkillIcon} strokeWidth={2} />
                    {t('language.label')}
                    <span className="text-muted-foreground ml-auto text-xs">
                      {t(`language.${locale}`)}
                    </span>
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    <DropdownMenuRadioGroup
                      value={locale}
                      onValueChange={(value: string) => startTransition(() => setLocale(value))}>
                      {locales.map((option) => (
                        <DropdownMenuRadioItem key={option} lang={option} value={option}>
                          {t(`language.${option}`)}
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <HugeiconsIcon icon={currentTheme.icon} strokeWidth={2} />
                    {t('theme.label')}
                    <span className="text-muted-foreground ml-auto text-xs">
                      {t(`theme.${currentTheme.value}`)}
                    </span>
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    <DropdownMenuRadioGroup value={currentTheme.value} onValueChange={setTheme}>
                      {themes.map((option) => (
                        <DropdownMenuRadioItem key={option.value} value={option.value}>
                          <HugeiconsIcon icon={option.icon} strokeWidth={2} />
                          {t(`theme.${option.value}`)}
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={signOutMutation.isPending}
                onClick={() => signOutMutation.mutate()}>
                <HugeiconsIcon icon={Logout03Icon} strokeWidth={2} />
                {signOutMutation.isPending ? t('session.signingOut') : t('session.signOut')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarMenuItem>
      </SidebarMenu>
    </>
  )
}
