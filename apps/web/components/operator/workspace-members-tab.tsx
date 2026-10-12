'use client'

import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import { useFormatter, useNow, useTranslations } from 'next-intl'
import { type ReactNode, type RefObject, useId, useRef, useState } from 'react'

import { CopyableValue, CopyButton } from '@/components/copy-button'
import { Failure, Loading } from '@/components/detail-parts'
import { RadioField, TextField } from '@/components/form-field'
import { ListNote, MemberList } from '@/components/members/member-list'
import { SettingsCard } from '@/components/settings/settings-card'
import { useValidatedSubmit } from '@/hooks/use-validated-submit'
import { createInvite, revokeInvite } from '@/lib/api/client'
import {
  operatorWorkspaceMembersQuery,
  storeCreatedInvite,
  storeRevokedInvite,
  workspaceInvitesQuery,
} from '@/lib/api/queries'
import { inviteStatus, type InviteStatus, validateInviteForm } from '@/lib/forms/operator'
import {
  type Invite,
  type InviteInput,
  inviteValidityDays,
  workspaceRoles,
  type WorkspaceRole,
  type WorkspaceSummary,
} from '@edi-bridge/contracts'
import { Alert, AlertDescription, AlertTitle } from '@edi-bridge/ui/components/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@edi-bridge/ui/components/alert-dialog'
import { Badge } from '@edi-bridge/ui/components/badge'
import { Button } from '@edi-bridge/ui/components/button'

function useDate() {
  const format = useFormatter()

  return (value: string) => format.dateTime(new Date(value), { dateStyle: 'medium' })
}

function CardQuery<Data>({
  query,
  namespace,
  children,
}: {
  query: UseQueryResult<Data>
  namespace: 'Operator.members' | 'Operator.invites'
  children: (data: Data) => ReactNode
}) {
  const t = useTranslations(namespace)

  if (query.isPending) {
    return <Loading label={t('loading')} rowClassName="h-12" rows={2} />
  }

  if (query.isError) {
    return (
      <Failure
        error={{
          title: t('error.title'),
          description: t('error.description'),
          retry: t('error.retry'),
        }}
        notFound={null}
        onRetry={() => void query.refetch()}
      />
    )
  }

  return children(query.data)
}

function Members({ workspaceId }: { workspaceId: string }) {
  const t = useTranslations('Operator.members')
  const members = useQuery(operatorWorkspaceMembersQuery(workspaceId))

  return (
    <SettingsCard description={t('description')} title={t('title')}>
      <CardQuery namespace="Operator.members" query={members}>
        {(data) => <MemberList empty={t('empty')} members={data} />}
      </CardQuery>
    </SettingsCard>
  )
}

function CreateInvite({ workspaceId }: { workspaceId: string }) {
  const t = useTranslations('Operator.invites.form')
  const date = useDate()
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
    <SettingsCard description={t('description', { days: inviteValidityDays })} title={t('title')}>
      <form
        noValidate
        aria-busy={create.isPending}
        aria-label={t('title')}
        className="flex flex-col gap-4"
        onSubmit={submit}>
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
          items={workspaceRoles.map((value) => ({
            value,
            label: t(`role.${value}.label`),
            detail: t(`role.${value}.detail`),
          }))}
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
        <Alert role={undefined} variant="success">
          <AlertTitle className="wrap-anywhere">
            {t('created.title', { email: invite.email })}
          </AlertTitle>
          <AlertDescription className="flex min-w-0 flex-col gap-3">
            <p>
              {t('created.description', {
                days: inviteValidityDays,
                date: date(invite.expiresAt),
              })}
            </p>
            <CopyableValue label={t('created.linkLabel')} value={invite.link} />
          </AlertDescription>
        </Alert>
      )}
    </SettingsCard>
  )
}

function OpenInvite({
  invite,
  onRevoke,
}: {
  invite: Invite
  onRevoke: (invite: Invite, trigger: HTMLButtonElement) => void
}) {
  const t = useTranslations('Operator.invites')
  const date = useDate()
  const id = useId()

  return (
    <li className="flex flex-col gap-2 py-3 @xl:flex-row @xl:items-center @xl:justify-between">
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
          <span id={id} className="wrap-anywhere">
            {invite.email}
          </span>
          <Badge variant={invite.role === 'admin' ? 'default' : 'secondary'}>
            {t(`role.${invite.role}`)}
          </Badge>
        </p>
        <p className="text-muted-foreground text-xs">
          {t('details', { createdAt: date(invite.createdAt), expiresAt: date(invite.expiresAt) })}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <CopyButton describedBy={id} label={t('linkLabel')} value={invite.link} />
        <Button
          size="sm"
          variant="ghost"
          aria-describedby={id}
          onClick={(event) => onRevoke(invite, event.currentTarget)}>
          {t('revoke.trigger')}
        </Button>
      </div>
    </li>
  )
}

type Earlier = { invite: Invite } & Exclude<InviteStatus, { status: 'pending' }>

function EarlierInvite({ invite, status, on }: Earlier) {
  const t = useTranslations('Operator.invites')
  const date = useDate()

  return (
    <li className="flex flex-col gap-0.5 py-2 @xl:flex-row @xl:items-center @xl:justify-between @xl:gap-4">
      <span className="min-w-0 text-sm wrap-anywhere">
        {invite.email}
        <span className="text-muted-foreground"> · {t(`role.${invite.role}`)}</span>
      </span>
      <span className="text-muted-foreground shrink-0 text-xs">
        {t(`status.${status}`, { date: date(on) })}
      </span>
    </li>
  )
}

function RevokeDialog({
  invite,
  open,
  opener,
  onOpenChange,
  onRevoked,
}: {
  invite: Invite | null
  open: boolean
  opener: RefObject<HTMLElement | null>
  onOpenChange: (open: boolean) => void
  onRevoked: (revoked: Invite) => void
}) {
  const t = useTranslations('Operator.invites.revoke')
  const queryClient = useQueryClient()
  const cancel = useRef<HTMLButtonElement>(null)

  const revoke = useMutation({
    mutationFn: (target: Invite) => revokeInvite(target.workspaceId, target.id),
    onSuccess: (revoked) => {
      onRevoked(revoked)
      storeRevokedInvite(queryClient, revoked)
    },
  })

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (revoke.isPending) {
          return
        }

        if (!next) {
          revoke.reset()
        }

        onOpenChange(next)
      }}>
      <AlertDialogContent
        finalFocus={opener}
        initialFocus={cancel}
        aria-busy={revoke.isPending || undefined}>
        <AlertDialogHeader>
          <AlertDialogTitle className="wrap-anywhere">
            {t('title', { email: invite?.email ?? '' })}
          </AlertDialogTitle>
          <AlertDialogDescription>{t('description')}</AlertDialogDescription>
        </AlertDialogHeader>
        {revoke.isError && (
          <p role="alert" className="text-sm text-red-800 dark:text-red-300">
            {t('failed')}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel
            ref={cancel}
            aria-disabled={revoke.isPending || undefined}
            className="aria-disabled:cursor-progress aria-disabled:opacity-50">
            {t('cancel')}
          </AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            aria-disabled={revoke.isPending || undefined}
            className="aria-disabled:cursor-progress aria-disabled:opacity-50"
            onClick={() => {
              if (invite && !revoke.isPending) {
                revoke.mutate(invite)
              }
            }}>
            {revoke.isPending ? t('revoking') : t('confirm')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function splitInvites(invites: readonly Invite[], now: Date) {
  const open: Invite[] = []
  const earlier: Earlier[] = []

  for (const invite of invites) {
    const state = inviteStatus(invite, now)

    if (state.status === 'pending') {
      open.push(invite)
    } else {
      earlier.push({ invite, ...state })
    }
  }

  return { open, earlier }
}

function InviteLists({ invites }: { invites: readonly Invite[] }) {
  const t = useTranslations('Operator.invites')
  const now = useNow({ updateInterval: 60_000 })
  const listId = useId()
  const list = useRef<HTMLParagraphElement>(null)
  const opener = useRef<HTMLElement | null>(null)
  const [target, setTarget] = useState<Invite | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [revoked, setRevoked] = useState<Invite | null>(null)
  const { open, earlier } = splitInvites(invites, now)

  return (
    <div className="flex flex-col gap-4">
      <p
        id={listId}
        ref={list}
        tabIndex={-1}
        className="text-muted-foreground text-sm outline-none">
        {t('count', { count: open.length })}
      </p>
      <p role="status" className="sr-only">
        {revoked && t('revoke.done', { email: revoked.email })}
      </p>
      {open.length === 0 ? (
        <ListNote>{t('empty')}</ListNote>
      ) : (
        <ul aria-labelledby={listId} className="@container divide-y border-y">
          {open.map((invite) => (
            <OpenInvite
              key={invite.id}
              invite={invite}
              onRevoke={(chosen, trigger) => {
                opener.current = trigger
                setTarget(chosen)
                setDialogOpen(true)
              }}
            />
          ))}
        </ul>
      )}
      {earlier.length > 0 && (
        <details className="group rounded-lg border">
          <summary className="cursor-pointer px-3 py-2 text-sm font-medium">
            {t('earlier.summary', { count: earlier.length })}
          </summary>
          <div className="flex flex-col gap-2 border-t px-3 pt-2 pb-1">
            <p className="text-muted-foreground text-sm">{t('earlier.description')}</p>
            <ul className="@container divide-y">
              {earlier.map((entry) => (
                <EarlierInvite key={entry.invite.id} {...entry} />
              ))}
            </ul>
          </div>
        </details>
      )}
      <RevokeDialog
        key={target?.id}
        invite={target}
        open={dialogOpen}
        opener={opener}
        onOpenChange={setDialogOpen}
        onRevoked={(done) => {
          opener.current = list.current
          setRevoked(done)
          setDialogOpen(false)
        }}
      />
    </div>
  )
}

function Invites({ workspaceId }: { workspaceId: string }) {
  const t = useTranslations('Operator.invites')
  const invites = useQuery(workspaceInvitesQuery(workspaceId))

  return (
    <SettingsCard description={t('description')} title={t('title')}>
      <CardQuery namespace="Operator.invites" query={invites}>
        {(data) => <InviteLists invites={data} />}
      </CardQuery>
    </SettingsCard>
  )
}

export function WorkspaceMembersTab({ workspace }: { workspace: WorkspaceSummary }) {
  return (
    <>
      <Members workspaceId={workspace.id} />
      <CreateInvite workspaceId={workspace.id} />
      <Invites workspaceId={workspace.id} />
    </>
  )
}
