'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { type FormEvent, type RefObject, useId, useRef, useState } from 'react'

import { RadioField, TextField } from '@/components/form-field'
import {
  type LookupTableField,
  type LookupTableFieldError,
  type LookupTableFormValues,
  type LookupTableSettings,
  type ScopeKind,
  toFormValues,
  validateLookupTableForm,
} from '@/components/lookup-tables/lookup-table-form-values'
import { scopeKey } from '@/components/lookup-tables/lookup-table-scope'
import { TradingPartnerChoice } from '@/components/lookup-tables/trading-partner-choice'
import { isConflict, updateLookupTable } from '@/lib/api/client'
import { lookupTableQuery, storeSavedLookupTable } from '@/lib/api/queries'
import { lookupTableInputSchema } from '@edi-bridge/contracts'
import { Button } from '@edi-bridge/ui/components/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@edi-bridge/ui/components/dialog'

import type { LookupTable, LookupTableSummary } from '@edi-bridge/contracts'

const scopeKinds = ['workspace', 'tradingPartner'] as const satisfies ReadonlyArray<ScopeKind>

function useFieldErrorMessage() {
  const t = useTranslations('LookupTables.form.errors')

  return (field: LookupTableField, error: LookupTableFieldError) =>
    error === 'tooLong'
      ? t('tooLong', { max: lookupTableInputSchema.shape.name.maxLength ?? 0 })
      : t(`required.${field}`)
}

function LookupTableForm({
  table,
  onSaved,
}: {
  table: LookupTableSummary
  onSaved: (saved: LookupTable) => void
}) {
  const t = useTranslations('LookupTables.form')
  const errorMessage = useFieldErrorMessage()
  const queryClient = useQueryClient()
  const baseId = useId()
  const formRef = useRef<HTMLFormElement>(null)

  const [values, setValues] = useState<LookupTableFormValues>(() => toFormValues(table))

  const [submitted, setSubmitted] = useState(false)
  const [taken, setTaken] = useState<{ name: string; scope: string } | null>(null)

  const save = useMutation({
    mutationFn: async (settings: LookupTableSettings) => {
      const { entries } = await queryClient.fetchQuery({
        ...lookupTableQuery(table.id),
        staleTime: 0,
      })

      return updateLookupTable(table.id, { ...settings, kind: table.kind, entries })
    },
    onSuccess: (saved) => {
      storeSavedLookupTable(queryClient, saved)
      onSaved(saved)
    },
    onError: (error, settings) => {
      if (isConflict(error)) {
        setTaken({ name: settings.name.toLocaleLowerCase(), scope: scopeKey(settings.scope) })
      }
    },
  })

  const ids = {
    name: `${baseId}-name`,
    scope: `${baseId}-scope`,
    tradingPartnerId: `${baseId}-trading-partner`,
  }

  const result = validateLookupTableForm(values)
  const errors = submitted && 'errors' in result ? result.errors : {}

  const conflict =
    'input' in result &&
    taken !== null &&
    result.input.name.toLocaleLowerCase() === taken.name &&
    scopeKey(result.input.scope) === taken.scope
      ? t('errors.taken')
      : null

  function messageFor(field: LookupTableField) {
    const error = errors[field]

    return error ? errorMessage(field, error) : field === 'name' ? conflict : null
  }

  function update<Field extends keyof LookupTableFormValues>(
    field: Field,
    value: LookupTableFormValues[Field],
  ) {
    setValues((current) => ({ ...current, [field]: value }))
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitted(true)

    if ('errors' in result) {
      const first = result.errors.name ? ids.name : ids.tradingPartnerId
      formRef.current?.querySelector<HTMLElement>(`#${CSS.escape(first)}`)?.focus()

      return
    }

    save.mutate(result.input)
  }

  return (
    <form
      noValidate
      ref={formRef}
      aria-busy={save.isPending}
      className="flex flex-col gap-4"
      onSubmit={submit}>
      <TextField
        id={ids.name}
        autoComplete="off"
        description={t('fields.name.description')}
        error={messageFor('name')}
        label={t('fields.name.label')}
        name="name"
        value={values.name}
        onChange={(value) => update('name', value)}
      />
      <RadioField
        id={ids.scope}
        description={t(`fields.scope.description.${values.scopeKind}`)}
        items={scopeKinds.map((kind) => ({ value: kind, label: t(`fields.scope.${kind}`) }))}
        label={t('fields.scope.label')}
        value={values.scopeKind}
        onChange={(value) => update('scopeKind', value)}
      />
      {values.scopeKind === 'tradingPartner' && (
        <TradingPartnerChoice
          id={ids.tradingPartnerId}
          error={messageFor('tradingPartnerId')}
          value={values.tradingPartnerId}
          onChange={(value) => update('tradingPartnerId', value)}
        />
      )}
      {save.isError && !conflict && (
        <p role="alert" className="text-sm text-red-800 dark:text-red-300">
          {t('errors.saveFailed')}
        </p>
      )}
      {conflict && (
        <p role="alert" className="sr-only">
          {conflict}
        </p>
      )}
      <DialogFooter>
        <DialogClose render={<Button variant="outline" />}>{t('cancel')}</DialogClose>
        <Button disabled={save.isPending} type="submit">
          {save.isPending ? t('saving') : t('save')}
        </Button>
      </DialogFooter>
    </form>
  )
}

export function LookupTableFormDialog({
  open,
  table,
  finalFocus,
  onOpenChange,
  onSaved,
}: {
  open: boolean
  table: LookupTableSummary | null
  finalFocus: RefObject<HTMLElement | null>
  onOpenChange: (open: boolean) => void
  onSaved: (saved: LookupTable) => void
}) {
  const t = useTranslations('LookupTables.form')

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t('close')} finalFocus={finalFocus} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{table && t('editTitle', { name: table.name })}</DialogTitle>
          <DialogDescription>{t('editDescription')}</DialogDescription>
        </DialogHeader>
        {table && <LookupTableForm key={table.id} table={table} onSaved={onSaved} />}
      </DialogContent>
    </Dialog>
  )
}
