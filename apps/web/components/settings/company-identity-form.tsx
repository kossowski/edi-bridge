'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { type FormEvent, useId, useState } from 'react'

import { GlnField, useGlnErrorMessage } from '@/components/form-field'
import { SettingsSection } from '@/components/settings/settings-section'
import { useSession } from '@/hooks/use-session'
import { updateCompanyIdentity } from '@/lib/api/client'
import { currentWorkspaceQuery } from '@/lib/api/queries'
import { glnError, normalizeGln } from '@/lib/forms/gln'
import { Button } from '@edi-bridge/ui/components/button'

import type { Workspace } from '@edi-bridge/contracts'

function MissingGln() {
  const t = useTranslations('Settings.companyIdentity')

  return (
    <p className="rounded-lg border border-amber-600/40 bg-amber-500/10 p-3 text-sm">
      {t('missing')}
    </p>
  )
}

function IdentityView({ workspace }: { workspace: Workspace }) {
  const t = useTranslations('Settings.companyIdentity')

  return (
    <div className="flex max-w-xl flex-col gap-6">
      {workspace.gln === null && <MissingGln />}
      <dl className="flex flex-col gap-4">
        <div className="flex flex-col gap-0.5">
          <dt className="text-muted-foreground text-xs">{t('companyName')}</dt>
          <dd className="text-sm">{workspace.name}</dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="text-muted-foreground text-xs">{t('gln.label')}</dt>
          <dd className="font-mono text-sm">{workspace.gln ?? t('notSet')}</dd>
        </div>
      </dl>
    </div>
  )
}

function IdentityForm({ workspace }: { workspace: Workspace }) {
  const t = useTranslations('Settings.companyIdentity')
  const errorMessage = useGlnErrorMessage()
  const queryClient = useQueryClient()
  const id = useId()
  const [gln, setGln] = useState(workspace.gln ?? '')
  const [submitted, setSubmitted] = useState(false)

  const save = useMutation({
    mutationFn: (value: string) => updateCompanyIdentity({ gln: value }),
    onSuccess: (updated) => {
      queryClient.setQueryData(currentWorkspaceQuery.queryKey, updated)
    },
  })

  const issue = glnError(gln)
  const error = submitted && issue ? errorMessage(issue) : null

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (save.isPending) {
      return
    }

    setSubmitted(true)
    save.reset()

    if (issue === null) {
      save.mutate(normalizeGln(gln))
    }
  }

  return (
    <form noValidate className="flex max-w-xl flex-col gap-6" onSubmit={submit}>
      {workspace.gln === null && <MissingGln />}
      <dl className="flex flex-col gap-0.5">
        <dt className="text-muted-foreground text-xs">{t('companyName')}</dt>
        <dd className="text-sm">{workspace.name}</dd>
      </dl>
      <GlnField
        id={id}
        description={t('gln.description')}
        error={error}
        label={t('gln.label')}
        value={gln}
        onChange={(value) => {
          setGln(value)
          save.reset()
        }}
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="submit"
          aria-disabled={save.isPending || undefined}
          className="aria-disabled:cursor-progress aria-disabled:opacity-50">
          {save.isPending ? t('saving') : t('save')}
        </Button>
        <p role="status" className="text-sm">
          {save.isSuccess && t('saved')}
        </p>
      </div>
      {save.isError && (
        <p role="alert" className="text-sm text-red-800 dark:text-red-300">
          {t('failed')}
        </p>
      )}
    </form>
  )
}

export function CompanyIdentitySection() {
  const t = useTranslations('Settings.companyIdentity')
  const session = useSession()
  const { data, status, refetch } = useQuery(currentWorkspaceQuery)

  return (
    <SettingsSection
      description={t('description')}
      status={session.isPending ? 'pending' : status}
      title={t('title')}
      onRetry={() => void refetch()}>
      {data &&
        (session.canChange ? <IdentityForm workspace={data} /> : <IdentityView workspace={data} />)}
    </SettingsSection>
  )
}
