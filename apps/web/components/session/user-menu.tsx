'use client'

import { Logout03Icon, UserCircleIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'

import { useSession } from '@/hooks/use-session'
import { signOut } from '@/lib/api/client'
import { Badge } from '@edi-bridge/ui/components/badge'
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

export function ViewOnlyBadge() {
  const t = useTranslations('Shell.session')
  const { viewer } = useSession()

  if (!viewer) {
    return null
  }

  return (
    <Badge variant="secondary" className="shrink-0">
      {t('viewOnly')}
      <span className="sr-only">: {t('viewOnlyDescription')}</span>
    </Badge>
  )
}

export function UserMenu() {
  const t = useTranslations('Shell.session')
  const queryClient = useQueryClient()
  const router = useRouter()
  const { session } = useSession()

  const leave = useMutation({
    mutationFn: signOut,
    onSuccess: () => {
      router.replace('/login')
      queryClient.clear()
    },
  })

  if (!session) {
    return null
  }

  const role = session.operator ? 'operator' : session.role

  return (
    <>
      {leave.isError && (
        <p role="alert" className="text-sm text-red-800 dark:text-red-300">
          {t('signOutFailed')}
        </p>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              aria-label={t('accountMenu', { name: session.user.name })}
              className="max-w-48"
            />
          }>
          <HugeiconsIcon icon={UserCircleIcon} strokeWidth={2} />
          <span className="hidden truncate sm:inline">{session.user.name}</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-56">
          <DropdownMenuGroup>
            <DropdownMenuLabel className="flex flex-col gap-0.5">
              <span className="text-muted-foreground text-xs">{t('signedInAs')}</span>
              <span className="text-foreground truncate font-medium">{session.user.name}</span>
              <span className="truncate">{session.user.email}</span>
              <span>
                {t(`role.${role}`)} · {session.workspace.name}
              </span>
            </DropdownMenuLabel>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={leave.isPending} onClick={() => leave.mutate()}>
            <HugeiconsIcon icon={Logout03Icon} strokeWidth={2} />
            {leave.isPending ? t('signingOut') : t('signOut')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  )
}
