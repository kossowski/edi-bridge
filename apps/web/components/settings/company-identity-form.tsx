'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { type FormEvent, useId, useState } from 'react'

import { LoadFailure } from '@/components/detail-parts'
import { GlnField, useGlnErrorMessage } from '@/components/form-field'
import { updateCompanyIdentity } from '@/lib/api/client'
import { currentWorkspaceQuery } from '@/lib/api/queries'
import { glnError, normalizeGln } from '@/lib/forms/gln'
import { Button } from '@edi-bridge/ui/components/button'
import { Skeleton } from '@edi-bridge/ui/components/skeleton'

import type { Workspace } from '@edi-bridge/contracts'

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
    setSubmitted(true)
    save.reset()

    if (issue === null) {
      save.mutate(normalizeGln(gln))
    }
  }

  return (
    <form noValidate className="flex max-w-xl flex-col gap-6" onSubmit={submit}>
      {workspace.gln === null && (
        <p className="rounded-lg border border-amber-600/40 bg-amber-500/10 p-3 text-sm">
          {t('missing')}
        </p>
      )}
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
        <Button disabled={save.isPending} type="submit">
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
  const t = useTranslations('Settings')
  const { data, isPending, refetch } = useQuery(currentWorkspaceQuery)

  return (
    <section aria-labelledby="company-identity" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id="company-identity" className="text-lg font-semibold">
          {t('companyIdentity.title')}
        </h2>
        <p className="text-muted-foreground text-sm">{t('companyIdentity.description')}</p>
      </div>
      {isPending ? (
        <div aria-busy className="flex max-w-xl flex-col gap-4">
          <p role="status" className="sr-only">
            {t('loading')}
          </p>
          <Skeleton className="h-10 w-48" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : data ? (
        <IdentityForm workspace={data} />
      ) : (
        <LoadFailure namespace="Settings" notFound={false} onRetry={() => void refetch()} />
      )}
    </section>
  )
}
