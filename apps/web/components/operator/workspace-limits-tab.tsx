'use client'

import { InformationCircleIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useFormatter, useLocale, useTranslations } from 'next-intl'
import { type FormEvent, type ReactNode, useId, useState } from 'react'

import { Failure, Loading } from '@/components/detail-parts'
import { TextField } from '@/components/form-field'
import { BudgetUsage } from '@/components/settings/budget-usage'
import { SettingsCard } from '@/components/settings/settings-card'
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
import { Alert, AlertDescription, AlertTitle } from '@edi-bridge/ui/components/alert'
import { Button } from '@edi-bridge/ui/components/button'

import type {
  WorkspaceSettings,
  WorkspaceSettingsInput,
  WorkspaceSummary,
} from '@edi-bridge/contracts'

function Limit({
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
  const t = useTranslations('Operator.limits')
  const format = useFormatter()
  const id = useId()
  const { messages, bounds } = workspaceSettingsFields[field]
  const range = { min: format.number(bounds.min), max: format.number(bounds.max) }

  return (
    <SettingsCard description={t(`${messages}.description`)} title={t(`${messages}.title`)}>
      <TextField
        id={id}
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
    </SettingsCard>
  )
}

function LimitsForm({
  settings,
  save,
}: {
  settings: WorkspaceSettings
  save: (input: WorkspaceSettingsInput) => Promise<WorkspaceSettings>
}) {
  const t = useTranslations('Operator.limits')
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
    <form noValidate className="flex flex-col gap-4" onSubmit={submit}>
      <Limit {...input('documentRetentionDays')} />
      <Limit {...input('dailyLimit')}>
        <BudgetUsage budget={settings.aiTokenBudget} />
      </Limit>
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

export function WorkspaceLimitsTab({ workspace }: { workspace: WorkspaceSummary }) {
  const workspaceId = workspace.id
  const t = useTranslations('Operator.limits')
  const queryClient = useQueryClient()
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
    <>
      <Alert role={undefined}>
        <HugeiconsIcon icon={InformationCircleIcon} strokeWidth={2} />
        <AlertTitle>{t('shown.title')}</AlertTitle>
        <AlertDescription>{t('shown.description')}</AlertDescription>
      </Alert>
      {isPending ? (
        <Loading label={t('loading')} rowClassName="h-28 rounded-xl" rows={2} />
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
        <LimitsForm save={save} settings={data} />
      )}
    </>
  )
}
