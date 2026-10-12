'use client'

import { Alert02Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { type FormEvent, useId, useState } from 'react'

import { LoadFailure } from '@/components/detail-parts'
import { GlnField, useGlnErrorMessage } from '@/components/form-field'
import { SettingsCard, SettingsTabLoading } from '@/components/settings/settings-card'
import { useSession } from '@/hooks/use-session'
import { updateCompanyIdentity } from '@/lib/api/client'
import { currentWorkspaceQuery } from '@/lib/api/queries'
import { glnError, normalizeGln } from '@/lib/forms/gln'
import { Alert, AlertDescription, AlertTitle } from '@edi-bridge/ui/components/alert'
import { Button } from '@edi-bridge/ui/components/button'

import type { Workspace } from '@edi-bridge/contracts'

function MissingGln({ canChange }: { canChange: boolean }) {
  const t = useTranslations('Settings.company.missing')

  return (
    <Alert role={undefined} className="border-amber-600/40 bg-amber-500/10">
      <HugeiconsIcon icon={Alert02Icon} strokeWidth={2} />
      <AlertTitle>{t('title')}</AlertTitle>
      <AlertDescription className="text-foreground">
        {canChange ? t('admin') : t('viewer')}
      </AlertDescription>
    </Alert>
  )
}

function CompanyName({ name }: { name: string }) {
  const t = useTranslations('Settings.company')

  return (
    <dl className="flex flex-col gap-0.5">
      <dt className="text-muted-foreground text-xs">{t('name')}</dt>
      <dd className="text-sm font-medium">{name}</dd>
    </dl>
  )
}

function CompanyView({ workspace }: { workspace: Workspace }) {
  const t = useTranslations('Settings.company')

  return (
    <dl className="flex flex-col gap-4">
      <div className="flex flex-col gap-0.5">
        <dt className="text-muted-foreground text-xs">{t('name')}</dt>
        <dd className="text-sm font-medium">{workspace.name}</dd>
      </div>
      <div className="flex flex-col gap-0.5">
        <dt className="text-muted-foreground text-xs">{t('gln.label')}</dt>
        <dd className="font-mono text-sm">{workspace.gln ?? t('notSet')}</dd>
      </div>
    </dl>
  )
}

function CompanyForm({ workspace }: { workspace: Workspace }) {
  const t = useTranslations('Settings.company')
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
    <form noValidate className="flex flex-col gap-4" onSubmit={submit}>
      <CompanyName name={workspace.name} />
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

export function CompanyTab() {
  const t = useTranslations('Settings.company')
  const session = useSession()
  const query = useQuery(currentWorkspaceQuery)

  if (session.isPending || query.isPending) {
    return <SettingsTabLoading />
  }

  if (query.isError) {
    return (
      <LoadFailure namespace="Settings" notFound={false} onRetry={() => void query.refetch()} />
    )
  }

  const { data } = query

  return (
    <>
      {data.gln === null && <MissingGln canChange={session.canChange} />}
      <SettingsCard description={t('description')} title={t('title')}>
        {session.canChange ? <CompanyForm workspace={data} /> : <CompanyView workspace={data} />}
      </SettingsCard>
    </>
  )
}
