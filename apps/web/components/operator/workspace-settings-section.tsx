'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useFormatter, useLocale, useTranslations } from 'next-intl'
import { type FormEvent, type ReactNode, useId, useState } from 'react'

import { Failure, Loading } from '@/components/detail-parts'
import { TextField } from '@/components/form-field'
import { BudgetUsage } from '@/components/settings/budget-usage'
import { useSession } from '@/hooks/use-session'
import { updateOperatorWorkspaceSettings } from '@/lib/api/client'
import {
  operatorWorkspaceSettingsQuery,
  storeSavedOperatorWorkspaceSettings,
} from '@/lib/api/queries'
import {
  groupSeparatorOf,
  toWorkspaceSettingsValues,
  validateWorkspaceSettings,
  type WholeNumberError,
  type WorkspaceSettingsField,
  workspaceSettingsFields,
  type WorkspaceSettingsValues,
} from '@/lib/forms/workspace-settings'
import { Button } from '@edi-bridge/ui/components/button'

import type { WorkspaceSettings, WorkspaceSettingsInput } from '@edi-bridge/contracts'

function Setting({
  field,
  value,
  error,
  onChange,
  children,
}: {
  field: WorkspaceSettingsField
  value: string
  error: WholeNumberError | undefined
  onChange: (value: string) => void
  children?: ReactNode
}) {
  const t = useTranslations('Operator.settings')
  const format = useFormatter()
  const id = useId()
  const { messages, bounds } = workspaceSettingsFields[field]
  const range = { min: format.number(bounds.min), max: format.number(bounds.max) }

  return (
    <div role="group" aria-labelledby={id} className="flex flex-col gap-3">
      <h3 id={id} className="text-base font-semibold">
        {t(`${messages}.title`)}
      </h3>
      <p className="text-muted-foreground text-sm">{t(`${messages}.description`)}</p>
      <TextField
        id={`${id}-input`}
        autoComplete="off"
        description={t(`${messages}.hint`, range)}
        error={error ? t(`${messages}.errors.${error}`, range) : null}
        inputMode="numeric"
        label={t(`${messages}.label`)}
        value={value}
        className="max-w-48"
        onChange={onChange}
      />
      {children}
    </div>
  )
}

function WorkspaceSettingsForm({
  settings,
  save,
}: {
  settings: WorkspaceSettings
  save: (input: WorkspaceSettingsInput) => Promise<WorkspaceSettings>
}) {
  const t = useTranslations('Operator.settings')
  const format = useFormatter()
  const groupSeparator = groupSeparatorOf(useLocale())
  const formatNumber = (value: number) => format.number(value)

  const [values, setValues] = useState(() => toWorkspaceSettingsValues(settings, formatNumber))
  const [submitted, setSubmitted] = useState(false)
  const mutation = useMutation({ mutationFn: save })

  const result = validateWorkspaceSettings(values, groupSeparator)
  const shown = submitted && 'errors' in result ? result.errors : {}

  function input(field: WorkspaceSettingsField) {
    return {
      field,
      value: values[field],
      error: shown[field],
      onChange: (value: string) => {
        setValues((current): WorkspaceSettingsValues => ({ ...current, [field]: value }))
        mutation.reset()
      },
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (mutation.isPending) {
      return
    }

    setSubmitted(true)
    mutation.reset()

    if ('input' in result) {
      mutation.mutate(result.input, {
        onSuccess: (updated) => setValues(toWorkspaceSettingsValues(updated, formatNumber)),
      })
    }
  }

  return (
    <form noValidate className="flex max-w-xl flex-col gap-6" onSubmit={submit}>
      <Setting {...input('documentRetentionDays')} />
      <Setting {...input('dailyLimit')}>
        <BudgetUsage budget={settings.aiTokenBudget} />
      </Setting>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="submit"
          aria-disabled={mutation.isPending || undefined}
          className="aria-disabled:cursor-progress aria-disabled:opacity-50">
          {mutation.isPending ? t('saving') : t('save')}
        </Button>
        <p role="status" className="text-sm">
          {mutation.isSuccess && t('saved')}
        </p>
      </div>
      {mutation.isError && (
        <p role="alert" className="text-sm text-red-800 dark:text-red-300">
          {t('failed')}
        </p>
      )}
    </form>
  )
}

export function WorkspaceSettingsSection({ workspaceId }: { workspaceId: string }) {
  const t = useTranslations('Operator.settings')
  const queryClient = useQueryClient()
  const id = useId()
  const { session } = useSession()

  const { data, isPending, isError, refetch } = useQuery(
    operatorWorkspaceSettingsQuery(workspaceId),
  )

  async function save(input: WorkspaceSettingsInput) {
    const updated = await updateOperatorWorkspaceSettings(workspaceId, input)
    storeSavedOperatorWorkspaceSettings(queryClient, workspaceId, updated, session?.workspace.id)

    return updated
  }

  return (
    <section aria-labelledby={id} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id={id} className="text-lg font-semibold">
          {t('title')}
        </h2>
        <p className="text-muted-foreground text-sm">{t('description')}</p>
      </div>
      {isPending ? (
        <Loading label={t('loading')} rowClassName="h-10" rows={2} />
      ) : isError ? (
        <Failure
          error={{
            title: t('error.title'),
            description: t('error.description'),
            retry: t('error.retry'),
          }}
          notFound={null}
          onRetry={() => void refetch()}
        />
      ) : (
        <WorkspaceSettingsForm save={save} settings={data} />
      )}
    </section>
  )
}
