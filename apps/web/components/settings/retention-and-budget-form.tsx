'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useFormatter, useTranslations } from 'next-intl'
import { type FormEvent, type ReactNode, useId, useState } from 'react'

import { LoadFailure } from '@/components/detail-parts'
import { TextField } from '@/components/form-field'
import { useSession } from '@/hooks/use-session'
import { updateWorkspaceSettings } from '@/lib/api/client'
import { workspaceSettingsQuery } from '@/lib/api/queries'
import {
  budgetUsage,
  toWorkspaceSettingsInput,
  type WholeNumberError,
  workspaceSettingsErrors,
  type WorkspaceSettingsValues,
} from '@/lib/forms/workspace-settings'
import {
  type AiTokenBudget,
  aiDailyTokenLimit,
  documentRetentionDays,
  type WorkspaceSettings,
  type WorkspaceSettingsInput,
} from '@edi-bridge/contracts'
import { Button } from '@edi-bridge/ui/components/button'
import { Skeleton } from '@edi-bridge/ui/components/skeleton'
import { cn } from '@edi-bridge/ui/lib/utils'

function Group({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <div role="group" aria-labelledby={id} className="flex flex-col gap-3">
      <h3 id={id} className="text-base font-semibold">
        {title}
      </h3>
      {children}
    </div>
  )
}

function BudgetUsage({ budget }: { budget: AiTokenBudget }) {
  const t = useTranslations('Settings.retentionAndBudget.budget')
  const format = useFormatter()
  const id = useId()
  const { off, exhausted, share } = budgetUsage(budget)

  if (off) {
    return <p className="text-sm">{t('off')}</p>
  }

  const used = t('used', {
    used: format.number(budget.usedToday),
    limit: format.number(budget.dailyLimit),
    share: format.number(budget.usedToday / budget.dailyLimit, {
      style: 'percent',
      maximumFractionDigits: 0,
    }),
  })

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-sm">
        <span id={`${id}-label`} className="font-medium">
          {t('usedLabel')}
        </span>
        <span className="tabular-nums">{used}</span>
      </div>
      <div
        role="meter"
        aria-labelledby={`${id}-label`}
        aria-valuemax={budget.dailyLimit}
        aria-valuemin={0}
        aria-valuenow={Math.min(budget.usedToday, budget.dailyLimit)}
        aria-valuetext={used}
        className="bg-muted h-2 overflow-hidden rounded-full border border-neutral-400 dark:border-neutral-500">
        <div
          className={cn(
            'h-full rounded-full',
            exhausted ? 'bg-red-700 dark:bg-red-400' : 'bg-primary',
          )}
          style={{ width: `${share * 100}%` }}
        />
      </div>
      {exhausted && (
        <p className="rounded-lg border border-red-700/40 bg-red-500/10 p-3 text-sm">
          {t('exhausted')}
        </p>
      )}
    </div>
  )
}

function useFieldError() {
  const t = useTranslations('Settings.retentionAndBudget')
  const format = useFormatter()

  return (field: keyof WorkspaceSettingsValues, error: WholeNumberError | undefined) => {
    if (error === undefined) {
      return null
    }

    const [key, bounds] =
      field === 'documentRetentionDays'
        ? (['retention', documentRetentionDays] as const)
        : (['budget', aiDailyTokenLimit] as const)

    return t(`${key}.errors.${error}`, {
      min: format.number(bounds.min),
      max: format.number(bounds.max),
    })
  }
}

export function RetentionAndBudgetForm({
  settings,
  editable,
  save,
}: {
  settings: WorkspaceSettings
  editable: boolean
  save: (input: WorkspaceSettingsInput) => Promise<WorkspaceSettings>
}) {
  const t = useTranslations('Settings.retentionAndBudget')
  const format = useFormatter()
  const fieldError = useFieldError()
  const id = useId()

  const [values, setValues] = useState<WorkspaceSettingsValues>(() => ({
    documentRetentionDays: format.number(settings.documentRetentionDays),
    dailyLimit: format.number(settings.aiTokenBudget.dailyLimit),
  }))

  const [submitted, setSubmitted] = useState(false)
  const mutation = useMutation({ mutationFn: save })

  const errors = workspaceSettingsErrors(values)
  const shown = submitted ? errors : {}

  function change(field: keyof WorkspaceSettingsValues, value: string) {
    setValues((current) => ({ ...current, [field]: value }))
    mutation.reset()
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitted(true)
    mutation.reset()

    if (Object.keys(errors).length === 0) {
      mutation.mutate(toWorkspaceSettingsInput(values))
    }
  }

  const bounds = {
    retention: {
      min: format.number(documentRetentionDays.min),
      max: format.number(documentRetentionDays.max),
    },
    budget: {
      min: format.number(aiDailyTokenLimit.min),
      max: format.number(aiDailyTokenLimit.max),
    },
  }

  const retention = (
    <Group id={`${id}-retention`} title={t('retention.title')}>
      <p className="text-muted-foreground text-sm">{t('retention.description')}</p>
      {editable ? (
        <TextField
          id={`${id}-retention-days`}
          autoComplete="off"
          description={t('retention.hint', bounds.retention)}
          error={fieldError('documentRetentionDays', shown.documentRetentionDays)}
          inputMode="numeric"
          label={t('retention.label')}
          value={values.documentRetentionDays}
          className="max-w-48"
          onChange={(value) => change('documentRetentionDays', value)}
        />
      ) : (
        <p className="text-sm font-medium">
          {t('retention.value', { days: settings.documentRetentionDays })}
        </p>
      )}
    </Group>
  )

  const budget = (
    <Group id={`${id}-budget`} title={t('budget.title')}>
      <p className="text-muted-foreground text-sm">{t('budget.description')}</p>
      {editable ? (
        <TextField
          id={`${id}-daily-limit`}
          autoComplete="off"
          description={t('budget.hint', bounds.budget)}
          error={fieldError('dailyLimit', shown.dailyLimit)}
          inputMode="numeric"
          label={t('budget.label')}
          value={values.dailyLimit}
          className="max-w-48"
          onChange={(value) => change('dailyLimit', value)}
        />
      ) : (
        <p className="text-sm font-medium">
          {t('budget.value', { limit: format.number(settings.aiTokenBudget.dailyLimit) })}
        </p>
      )}
      <BudgetUsage budget={settings.aiTokenBudget} />
    </Group>
  )

  if (!editable) {
    return (
      <div className="flex max-w-xl flex-col gap-6">
        <p className="rounded-lg border p-3 text-sm">{t('setByOperator')}</p>
        {retention}
        {budget}
      </div>
    )
  }

  return (
    <form noValidate className="flex max-w-xl flex-col gap-6" onSubmit={submit}>
      {retention}
      {budget}
      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={mutation.isPending} type="submit">
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

export function RetentionAndBudgetSection() {
  const t = useTranslations('Settings')
  const queryClient = useQueryClient()
  const session = useSession()
  const { data, isPending, refetch } = useQuery(workspaceSettingsQuery)

  async function save(input: WorkspaceSettingsInput) {
    const updated = await updateWorkspaceSettings(input)
    queryClient.setQueryData(workspaceSettingsQuery.queryKey, updated)

    return updated
  }

  return (
    <section aria-labelledby="retention-and-budget" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id="retention-and-budget" className="text-lg font-semibold">
          {t('retentionAndBudget.title')}
        </h2>
        <p className="text-muted-foreground text-sm">{t('retentionAndBudget.description')}</p>
      </div>
      {isPending || session.isPending ? (
        <div aria-busy className="flex max-w-xl flex-col gap-4">
          <p role="status" className="sr-only">
            {t('loading')}
          </p>
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : data ? (
        <RetentionAndBudgetForm editable={session.operator} save={save} settings={data} />
      ) : (
        <LoadFailure namespace="Settings" notFound={false} onRetry={() => void refetch()} />
      )}
    </section>
  )
}
