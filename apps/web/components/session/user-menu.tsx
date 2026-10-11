'use client'

import { Logout03Icon, UserCircleIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'

import { focusMainContentOnNextPage } from '@/components/main-content-focus'
import { useSession } from '@/hooks/use-session'
import { signOut } from '@/lib/api/client'
import { Button } from '@edi-bridge/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@edi-bridge/ui/components/dropdown-menu'
import { cn } from '@edi-bridge/ui/lib/utils'

export function UserMenu() {
  const t = useTranslations('Shell.session')
  const queryClient = useQueryClient()
  const router = useRouter()
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

  return (
    <>
      {signOutMutation.isError && (
        <p role="alert" className="text-sm text-red-800 dark:text-red-300">
          {t('signOutFailed')}
        </p>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              aria-label={
                session ? t('userMenu', { name: session.user.name }) : t('userMenuUnavailable')
              }
              className="max-w-48"
            />
          }>
          <HugeiconsIcon icon={UserCircleIcon} strokeWidth={2} />
          <span className={cn('truncate', session && 'hidden sm:inline')}>
            {session ? session.user.name : t('unavailable')}
          </span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuGroup>
            {session ? (
              <DropdownMenuLabel className="flex flex-col gap-0.5">
                <span className="text-muted-foreground text-xs">{t('signedInAs')}</span>
                <span className="text-foreground font-medium break-words">{session.user.name}</span>
                <span className="break-all">{session.user.email}</span>
                <span>
                  {[operator && t('operator'), role && t(`role.${role}`), session.workspace.name]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </DropdownMenuLabel>
            ) : (
              <DropdownMenuLabel>{t('unavailableDescription')}</DropdownMenuLabel>
            )}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={signOutMutation.isPending}
            onClick={() => signOutMutation.mutate()}>
            <HugeiconsIcon icon={Logout03Icon} strokeWidth={2} />
            {signOutMutation.isPending ? t('signingOut') : t('signOut')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  )
}
