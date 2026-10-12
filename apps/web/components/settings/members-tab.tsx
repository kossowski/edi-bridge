'use client'

import { InformationCircleIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useQuery } from '@tanstack/react-query'
import { useFormatter, useLocale, useNow, useTranslations } from 'next-intl'
import { type ReactNode, useId, useMemo, useState } from 'react'

import { SettingsCard, SettingsTabContent } from '@/components/settings/settings-card'
import { useSession } from '@/hooks/use-session'
import { workspaceMembersQuery } from '@/lib/api/queries'
import { Alert, AlertDescription, AlertTitle } from '@edi-bridge/ui/components/alert'
import { Badge } from '@edi-bridge/ui/components/badge'
import { Input } from '@edi-bridge/ui/components/input'

import type { WorkspaceMember } from '@edi-bridge/contracts'

const searchAboveMemberCount = 10

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

function LastActivity({ at, now }: { at: string | null; now: Date }) {
  const t = useTranslations('Settings.members')
  const format = useFormatter()

  if (at === null) {
    return <span className="text-muted-foreground text-xs italic">{t('neverSignedIn')}</span>
  }

  return (
    <time dateTime={at} className="text-muted-foreground text-xs">
      {t('lastActive', { time: format.relativeTime(new Date(at), now) })}
    </time>
  )
}

function MemberRow({
  member,
  isCurrentUser,
  now,
}: {
  member: WorkspaceMember
  isCurrentUser: boolean
  now: Date
}) {
  const t = useTranslations('Settings.members')

  return (
    <li className="grid gap-x-4 gap-y-1.5 py-3 @2xl:grid-cols-[minmax(0,1fr)_5rem_8rem] @2xl:items-center">
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
          <span className="wrap-break-word">{member.name}</span>
          {isCurrentUser && <Badge variant="outline">{t('you')}</Badge>}
        </p>
        <p className="text-muted-foreground text-sm wrap-break-word">{member.email}</p>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 @2xl:contents">
        <Badge variant={member.role === 'admin' ? 'default' : 'secondary'}>
          {t(`roles.${member.role}`)}
        </Badge>
        <LastActivity at={member.lastActivityAt} now={now} />
      </div>
    </li>
  )
}

function ListNote({ children }: { children: ReactNode }) {
  return <p className="text-muted-foreground rounded-lg border p-3 text-sm">{children}</p>
}

export function MemberList({
  members,
  userId,
}: {
  members: WorkspaceMember[]
  userId: string | undefined
}) {
  const t = useTranslations('Settings.members')
  const locale = useLocale()
  const now = useNow({ updateInterval: 60_000 })
  const searchId = useId()
  const [search, setSearch] = useState('')

  const sorted = useMemo(() => {
    const collator = new Intl.Collator(locale, { sensitivity: 'base' })

    return members.toSorted(
      (a, b) =>
        Number(b.role === 'admin') - Number(a.role === 'admin') || collator.compare(a.name, b.name),
    )
  }, [members, locale])

  if (members.length === 0) {
    return <ListNote>{t('empty')}</ListNote>
  }

  const term = search.trim().toLocaleLowerCase(locale)

  const shown =
    term === ''
      ? sorted
      : sorted.filter(
          (member) =>
            member.name.toLocaleLowerCase(locale).includes(term) ||
            member.email.toLocaleLowerCase(locale).includes(term),
        )

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        {members.length > searchAboveMemberCount && (
          <search className="flex w-full flex-col gap-1.5 sm:w-72">
            <label htmlFor={searchId} className="text-sm font-medium">
              {t('search')}
            </label>
            <Input
              id={searchId}
              autoComplete="off"
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </search>
        )}
        <p aria-live="polite" className="text-muted-foreground text-sm">
          {term === ''
            ? t('count', { count: members.length })
            : t('filteredCount', { count: shown.length, total: members.length })}
        </p>
      </div>
      {shown.length === 0 ? (
        <ListNote>{t('noMatch', { search: search.trim() })}</ListNote>
      ) : (
        <ul className="@container divide-y border-y">
          {shown.map((member) => (
            <MemberRow
              key={member.id}
              isCurrentUser={member.id === userId}
              member={member}
              now={now}
            />
          ))}
        </ul>
      )}
    </div>
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
            <MemberList members={members} userId={session.session?.user.id} />
          </SettingsCard>
        </>
      )}
    </SettingsTabContent>
  )
}
