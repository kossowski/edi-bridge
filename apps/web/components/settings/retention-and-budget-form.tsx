'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useFormatter, useLocale, useTranslations } from 'next-intl'
import { type FormEvent, type ReactNode, useId, useState } from 'react'

import { TextField } from '@/components/form-field'
import { SettingsSection } from '@/components/settings/settings-section'
import { useSession } from '@/hooks/use-session'
import { updateWorkspaceSettings } from '@/lib/api/client'
import { storeSavedWorkspaceSettings, workspaceSettingsQuery } from '@/lib/api/queries'
import {
  budgetUsage,
  groupSeparatorOf,
  toWorkspaceSettingsValues,
  validateWorkspaceSettings,
  type WholeNumberError,
  type WorkspaceSettingsField,
  workspaceSettingsFields,
  type WorkspaceSettingsValues,
} from '@/lib/forms/workspace-settings'
import { Button } from '@edi-bridge/ui/components/button'
import { Progress, ProgressLabel, ProgressValue } from '@edi-bridge/ui/components/progress'
import { cn } from '@edi-bridge/ui/lib/utils'

import type {
  AiTokenBudget,
  WorkspaceSettings,
  WorkspaceSettingsInput,
} from '@edi-bridge/contracts'

function BudgetUsage({ budget }: { budget: AiTokenBudget }) {
  const t = useTranslations('Settings.retentionAndBudget.budget')
  const format = useFormatter()
  const usage = budgetUsage(budget)

  if (usage.turnedOff) {
    return <p className="text-sm">{t('turnedOff')}</p>
  }

  const used = t('used', {
    used: format.number(budget.usedToday),
    limit: format.number(budget.dailyLimit),
    share: format.number(usage.share, { style: 'percent', maximumFractionDigits: 0 }),
  })

  return (
    <div className="flex flex-col gap-2">
      <Progress
        getAriaValueText={() => used}
        max={1}
        value={usage.filled}
        className={cn(
          'gap-x-4 gap-y-2 *:data-[slot=progress-track]:h-2 *:data-[slot=progress-track]:border *:data-[slot=progress-track]:border-neutral-400 dark:*:data-[slot=progress-track]:border-neutral-500',
          usage.exhausted &&
            '**:data-[slot=progress-indicator]:bg-red-700 dark:**:data-[slot=progress-indicator]:bg-red-400',
        )}>
        <ProgressLabel>{t('usedLabel')}</ProgressLabel>
        <ProgressValue className="text-foreground">{() => used}</ProgressValue>
      </Progress>
      {usage.exhausted && (
        <p className="rounded-lg border border-red-700/40 bg-red-500/10 p-3 text-sm">
          {t('exhausted')}
        </p>
      )}
    </div>
  )
}

function Setting({
  field,
  settings,
  input,
  children,
}: {
  field: WorkspaceSettingsField
  settings: WorkspaceSettings
  input: {
    value: string
    error: WholeNumberError | undefined
    onChange: (value: string) => void
  } | null
  children?: ReactNode
}) {
  const t = useTranslations('Settings.retentionAndBudget')
  const format = useFormatter()
  const id = useId()
  const { messages, bounds, of } = workspaceSettingsFields[field]
  const range = { min: format.number(bounds.min), max: format.number(bounds.max) }

  return (
    <div role="group" aria-labelledby={id} className="flex flex-col gap-3">
      <h3 id={id} className="text-base font-semibold">
        {t(`${messages}.title`)}
      </h3>
      <p className="text-muted-foreground text-sm">{t(`${messages}.description`)}</p>
      {input ? (
        <TextField
          id={`${id}-input`}
          autoComplete="off"
          description={t(`${messages}.hint`, range)}
          error={input.error ? t(`${messages}.errors.${input.error}`, range) : null}
          inputMode="numeric"
          label={t(`${messages}.label`)}
          value={input.value}
          className="max-w-48"
          onChange={input.onChange}
        />
      ) : (
        <p className="text-sm font-medium">{t(`${messages}.value`, { value: of(settings) })}</p>
      )}
      {children}
    </div>
  )
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
  const groupSeparator = groupSeparatorOf(useLocale())
  const formatNumber = (value: number) => format.number(value)

  const [values, setValues] = useState(() => toWorkspaceSettingsValues(settings, formatNumber))
  const [submitted, setSubmitted] = useState(false)
  const mutation = useMutation({ mutationFn: save })

  const result = validateWorkspaceSettings(values, groupSeparator)
  const shown = submitted && 'errors' in result ? result.errors : {}

  function input(field: WorkspaceSettingsField) {
    if (!editable) {
      return null
    }

    return {
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

  const fields = (
    <>
      <Setting
        field="documentRetentionDays"
        input={input('documentRetentionDays')}
        settings={settings}
      />
      <Setting field="dailyLimit" input={input('dailyLimit')} settings={settings}>
        <BudgetUsage budget={settings.aiTokenBudget} />
      </Setting>
    </>
  )

  if (!editable) {
    return (
      <div className="flex max-w-xl flex-col gap-6">
        <p className="rounded-lg border p-3 text-sm">{t('setByOperator')}</p>
        {fields}
      </div>
    )
  }

  return (
    <form noValidate className="flex max-w-xl flex-col gap-6" onSubmit={submit}>
      {fields}
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

export function RetentionAndBudgetSection() {
  const t = useTranslations('Settings.retentionAndBudget')
  const queryClient = useQueryClient()
  const session = useSession()
  const { data, status, refetch } = useQuery(workspaceSettingsQuery)

  async function save(input: WorkspaceSettingsInput) {
    const updated = await updateWorkspaceSettings(input)
    storeSavedWorkspaceSettings(queryClient, updated, session.session?.workspace.id)

    return updated
  }

  return (
    <SettingsSection
      description={t('description')}
      status={session.isPending ? 'pending' : status}
      title={t('title')}
      onRetry={() => void refetch()}>
      {data && <RetentionAndBudgetForm editable={session.operator} save={save} settings={data} />}
    </SettingsSection>
  )
}
