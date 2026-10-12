'use client'

import { InformationCircleIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'

import { MemberList } from '@/components/members/member-list'
import { SettingsCard, SettingsTabContent } from '@/components/settings/settings-card'
import { useSession } from '@/hooks/use-session'
import { workspaceMembersQuery } from '@/lib/api/queries'
import { Alert, AlertDescription, AlertTitle } from '@edi-bridge/ui/components/alert'

function AskOperator({ canChange }: { canChange: boolean }) {
  const t = useTranslations('Settings.members.askOperator')

  return (
    <Alert role={undefined}>
      <HugeiconsIcon icon={InformationCircleIcon} strokeWidth={2} />
      <AlertTitle>{t('title')}</AlertTitle>
      <AlertDescription>{canChange ? t('admin') : t('viewer')}</AlertDescription>
    </Alert>
  )
}

export function MembersTab() {
  const t = useTranslations('Settings.members')
  const session = useSession()
  const query = useQuery(workspaceMembersQuery)

  return (
    <SettingsTabContent query={query} waiting={session.isPending}>
      {(members) => (
        <>
          <AskOperator canChange={session.canChange} />
          <SettingsCard description={t('description')} title={t('title')}>
            <MemberList
              currentUserId={session.session?.user.id}
              empty={t('empty')}
              members={members}
            />
          </SettingsCard>
        </>
      )}
    </SettingsTabContent>
  )
}
