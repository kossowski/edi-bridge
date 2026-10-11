'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useFormatter, useNow, useTranslations } from 'next-intl'
import { useId, useRef, useState } from 'react'

import { CopyableValue, CopyButton } from '@/components/copy-button'
import { Failure, Loading } from '@/components/detail-parts'
import { RadioField, TextField } from '@/components/form-field'
import { useValidatedSubmit } from '@/hooks/use-validated-submit'
import { createInvite } from '@/lib/api/client'
import { storeCreatedInvite, workspaceInvitesQuery } from '@/lib/api/queries'
import { inviteStatus, validateInviteForm } from '@/lib/forms/operator'
import {
  type Invite,
  type InviteInput,
  workspaceRoles,
  type WorkspaceRole,
} from '@edi-bridge/contracts'
import { Alert, AlertDescription, AlertTitle } from '@edi-bridge/ui/components/alert'
import { Button } from '@edi-bridge/ui/components/button'
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

const columns = [
  { key: 'email', className: '' },
  { key: 'role', className: 'hidden @2xl:table-cell' },
  { key: 'createdAt', className: 'hidden @2xl:table-cell' },
  { key: 'expiresAt', className: 'hidden @2xl:table-cell' },
  { key: 'status', className: '' },
] as const

function InviteRow({ invite, now }: { invite: Invite; now: Date }) {
  const t = useTranslations('Operator.invites')
  const format = useFormatter()
  const id = useId()
  const status = inviteStatus(invite, now)
  const date = (value: string) => format.dateTime(new Date(value), { dateStyle: 'medium' })

  return (
    <TableRow>
      <TableCell className="min-w-40 whitespace-normal">
        <span id={`${id}-email`} className="font-medium wrap-anywhere">
          {invite.email}
        </span>
        <span className="text-muted-foreground mt-0.5 block text-xs @2xl:hidden">
          {t('details', {
            role: t(`role.${invite.role}`),
            createdAt: date(invite.createdAt),
            expiresAt: date(invite.expiresAt),
          })}
        </span>
      </TableCell>
      <TableCell className="hidden @2xl:table-cell">{t(`role.${invite.role}`)}</TableCell>
      <TableCell className="hidden tabular-nums @2xl:table-cell">
        {date(invite.createdAt)}
      </TableCell>
      <TableCell className="hidden tabular-nums @2xl:table-cell">
        {date(invite.expiresAt)}
      </TableCell>
      <TableCell className="whitespace-normal">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span
            className={cn(
              status === 'accepted' && 'text-emerald-800 dark:text-emerald-300',
              status === 'expired' && 'text-muted-foreground',
            )}>
            {invite.acceptedAt !== null
              ? t('status.accepted', { date: date(invite.acceptedAt) })
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
    return <Loading label={t('loading')} rowClassName="h-10" rows={2} />
  }

  if (invites.isError) {
    return (
      <Failure
        error={{
          title: t('error.title'),
          description: t('error.description'),
          retry: t('error.retry'),
        }}
        notFound={null}
        onRetry={() => void invites.refetch()}
      />
    )
  }

  if (invites.data.length === 0) {
    return <p className="text-muted-foreground rounded-lg border p-3 text-sm">{t('empty')}</p>
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-muted-foreground text-sm">{t('count', { count: invites.data.length })}</p>
      <div className="@container rounded-lg border">
        <Table>
          <TableCaption className="sr-only">{t('caption')}</TableCaption>
          <TableHeader>
            <TableRow>
              {columns.map((column) => (
                <TableHead key={column.key} scope="col" className={column.className}>
                  {t(`columns.${column.key}`)}
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

  const create = useMutation({
    mutationFn: (input: InviteInput) => createInvite(workspaceId, input),
    onSuccess: (invite) => {
      storeCreatedInvite(queryClient, workspaceId, invite)
      setEmail('')
    },
  })

  const result = validateInviteForm({ email, role })

  const { submitted, submit } = useValidatedSubmit({
    result,
    mutation: create,
    firstInvalid: emailInput,
  })

  const emailError = submitted && 'error' in result ? t(`errors.${result.error}`) : null
  const invite = create.data

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
        <Alert role={undefined} variant="success" className="max-w-xl">
          <AlertTitle>{t('created.title', { email: invite.email })}</AlertTitle>
          <AlertDescription className="flex flex-col gap-3">
            <div>
              {t('created.description', {
                date: format.dateTime(new Date(invite.expiresAt), { dateStyle: 'medium' }),
              })}
            </div>
            <CopyableValue label={t('created.linkLabel')} value={invite.link} />
          </AlertDescription>
        </Alert>
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
