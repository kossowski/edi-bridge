'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useFormatter, useNow, useTranslations } from 'next-intl'
import { type FormEvent, useId, useRef, useState } from 'react'

import { CopyableValue, CopyButton } from '@/components/copy-button'
import { RadioField, TextField } from '@/components/form-field'
import { createInvite } from '@/lib/api/client'
import { workspaceInvitesQuery } from '@/lib/api/queries'
import { inviteStatus, validateInviteForm } from '@/lib/forms/operator'
import { type Invite, workspaceRoles, type WorkspaceRole } from '@edi-bridge/contracts'
import { Button } from '@edi-bridge/ui/components/button'
import { Skeleton } from '@edi-bridge/ui/components/skeleton'
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@edi-bridge/ui/components/table'
import { cn } from '@edi-bridge/ui/lib/utils'

const columns = ['email', 'role', 'createdAt', 'expiresAt', 'status'] as const

function InviteRow({ invite, now }: { invite: Invite; now: Date }) {
  const t = useTranslations('Operator.invites')
  const format = useFormatter()
  const id = useId()
  const status = inviteStatus(invite, now)
  const date = (value: string) => format.dateTime(new Date(value), { dateStyle: 'medium' })

  return (
    <TableRow>
      <TableCell id={`${id}-email`} className="min-w-40 font-medium break-all whitespace-normal">
        {invite.email}
      </TableCell>
      <TableCell>{t(`role.${invite.role}`)}</TableCell>
      <TableCell className="tabular-nums">{date(invite.createdAt)}</TableCell>
      <TableCell className="tabular-nums">{date(invite.expiresAt)}</TableCell>
      <TableCell>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span
            className={cn(
              status === 'accepted' && 'text-emerald-800 dark:text-emerald-300',
              status === 'expired' && 'text-muted-foreground',
            )}>
            {status === 'accepted'
              ? t('status.accepted', { date: date(invite.acceptedAt ?? invite.createdAt) })
              : t(`status.${status}`)}
          </span>
          {status === 'pending' && (
            <CopyButton describedBy={`${id}-email`} label={t('linkLabel')} value={invite.link} />
          )}
        </div>
      </TableCell>
    </TableRow>
  )
}

function InviteList({ workspaceId }: { workspaceId: string }) {
  const t = useTranslations('Operator.invites')
  const now = useNow({ updateInterval: 60_000 })
  const invites = useQuery(workspaceInvitesQuery(workspaceId))

  if (invites.isPending) {
    return (
      <div aria-busy className="flex flex-col gap-2">
        <p role="status" className="sr-only">
          {t('loading')}
        </p>
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    )
  }

  if (invites.isError) {
    return (
      <div className="flex flex-col items-start gap-2">
        <p className="text-sm text-red-800 dark:text-red-300">{t('failed')}</p>
        <Button size="sm" variant="outline" onClick={() => void invites.refetch()}>
          {t('retry')}
        </Button>
      </div>
    )
  }

  if (invites.data.length === 0) {
    return <p className="text-muted-foreground rounded-lg border p-3 text-sm">{t('empty')}</p>
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-muted-foreground text-sm">{t('count', { count: invites.data.length })}</p>
      <div className="rounded-lg border">
        <Table>
          <TableCaption className="sr-only">{t('caption')}</TableCaption>
          <TableHeader>
            <TableRow>
              {columns.map((column) => (
                <TableHead key={column} scope="col">
                  {t(`columns.${column}`)}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {invites.data.map((invite) => (
              <InviteRow key={invite.id} invite={invite} now={now} />
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

function CreateInviteForm({ workspaceId }: { workspaceId: string }) {
  const t = useTranslations('Operator.invites.form')
  const format = useFormatter()
  const queryClient = useQueryClient()
  const id = useId()
  const emailInput = useRef<HTMLInputElement>(null)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<WorkspaceRole>('viewer')
  const [submitted, setSubmitted] = useState(false)

  const create = useMutation({
    mutationFn: (input: Parameters<typeof createInvite>[1]) => createInvite(workspaceId, input),
    onSuccess: (invite) => {
      queryClient.setQueryData<Invite[]>(
        workspaceInvitesQuery(workspaceId).queryKey,
        (invites) => invites && [invite, ...invites],
      )
      setEmail('')
      setSubmitted(false)
    },
  })

  const result = validateInviteForm({ email, role })
  const emailError = submitted && 'error' in result ? t(`errors.${result.error}`) : null
  const invite = create.data

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (create.isPending) {
      return
    }

    setSubmitted(true)

    if ('error' in result) {
      emailInput.current?.focus()

      return
    }

    create.mutate(result.input)
  }

  return (
    <div className="flex flex-col gap-4">
      <form
        noValidate
        aria-busy={create.isPending}
        aria-labelledby={`${id}-title`}
        className="flex max-w-xl flex-col gap-4 rounded-lg border p-4"
        onSubmit={submit}>
        <h3 id={`${id}-title`} className="text-base font-semibold">
          {t('title')}
        </h3>
        <TextField
          id={`${id}-email`}
          autoComplete="off"
          description={t('email.description')}
          error={emailError}
          label={t('email.label')}
          name="email"
          ref={emailInput}
          spellCheck={false}
          type="email"
          value={email}
          className="sm:w-80"
          onChange={setEmail}
        />
        <RadioField
          id={`${id}-role`}
          description={t('role.description')}
          items={workspaceRoles.map((value) => ({ value, label: t(`role.${value}`) }))}
          label={t('role.label')}
          value={role}
          onChange={setRole}
        />
        <div>
          <Button
            type="submit"
            aria-disabled={create.isPending || undefined}
            className="aria-disabled:cursor-progress aria-disabled:opacity-50">
            {create.isPending ? t('creating') : t('submit')}
          </Button>
        </div>
        {create.isError && (
          <p role="alert" className="text-sm text-red-800 dark:text-red-300">
            {t('errors.failed')}
          </p>
        )}
      </form>
      <p role="status" className="sr-only">
        {invite && t('created.announcement', { email: invite.email })}
      </p>
      {invite && (
        <div className="flex max-w-xl flex-col gap-3 rounded-lg border border-emerald-700/40 bg-emerald-500/10 p-4">
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium">{t('created.title', { email: invite.email })}</p>
            <p className="text-sm">
              {t('created.description', {
                date: format.dateTime(new Date(invite.expiresAt), { dateStyle: 'medium' }),
              })}
            </p>
          </div>
          <CopyableValue label={t('created.linkLabel')} value={invite.link} />
        </div>
      )}
    </div>
  )
}

export function WorkspaceInvites({ workspaceId }: { workspaceId: string }) {
  const t = useTranslations('Operator.invites')
  const id = useId()

  return (
    <section aria-labelledby={id} className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id={id} className="text-lg font-semibold">
          {t('title')}
        </h2>
        <p className="text-muted-foreground text-sm">{t('description')}</p>
      </div>
      <CreateInviteForm workspaceId={workspaceId} />
      <InviteList workspaceId={workspaceId} />
    </section>
  )
}
