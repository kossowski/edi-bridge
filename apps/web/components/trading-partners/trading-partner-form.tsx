'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { type FormEvent, useId, useRef, useState } from 'react'

import { GlnField, SelectField, TextField, useGlnErrorMessage } from '@/components/form-field'
import {
  type FieldError,
  toFormValues,
  type TradingPartnerField,
  type TradingPartnerFormValues,
  validateTradingPartnerForm,
} from '@/components/trading-partners/trading-partner-form-values'
import { ApiError, createTradingPartner, updateTradingPartner } from '@/lib/api/client'
import { storeSavedTradingPartner } from '@/lib/api/queries'
import {
  acknowledgementTimeLimitHours,
  characterSets,
  type TradingPartner,
  type TradingPartnerInput,
  tradingPartnerInputSchema,
} from '@edi-bridge/contracts'
import { Button, buttonVariants } from '@edi-bridge/ui/components/button'

function useFieldErrorMessage() {
  const t = useTranslations('TradingPartnerForm.errors')
  const glnErrorMessage = useGlnErrorMessage()

  return (field: TradingPartnerField, error: FieldError) => {
    switch (error) {
      case 'tooLong':
        return t('tooLong', { max: tradingPartnerInputSchema.shape.name.maxLength ?? 0 })
      case 'range':
        return t('range', acknowledgementTimeLimitHours)
      case 'required':
        if (field === 'name' || field === 'characterSet') {
          return t(`required.${field}`)
        }

        return glnErrorMessage(error)
      default:
        return glnErrorMessage(error)
    }
  }
}

export function TradingPartnerForm({ tradingPartner }: { tradingPartner?: TradingPartner }) {
  const t = useTranslations('TradingPartnerForm')
  const errorMessage = useFieldErrorMessage()
  const queryClient = useQueryClient()
  const router = useRouter()
  const baseId = useId()
  const formRef = useRef<HTMLFormElement>(null)
  const [values, setValues] = useState<TradingPartnerFormValues>(() => toFormValues(tradingPartner))
  const [submitted, setSubmitted] = useState(false)
  const [glnTaken, setGlnTaken] = useState<string | null>(null)

  const save = useMutation({
    mutationFn: (input: TradingPartnerInput) =>
      tradingPartner ? updateTradingPartner(tradingPartner.id, input) : createTradingPartner(input),
    onSuccess: (saved) => {
      storeSavedTradingPartner(queryClient, saved)
      router.push(`/trading-partners/${saved.id}`)
    },
    onError: (error, input) => {
      if (error instanceof ApiError && error.status === 409) {
        setGlnTaken(input.gln)
      }
    },
  })

  const result = validateTradingPartnerForm(values)
  const errors = submitted && 'errors' in result ? result.errors : {}

  const conflict =
    'input' in result && glnTaken !== null && result.input.gln === glnTaken
      ? t('errors.gln.taken')
      : null

  function messageFor(field: TradingPartnerField) {
    const error = errors[field]

    return error ? errorMessage(field, error) : field === 'gln' ? conflict : null
  }

  function update<Field extends TradingPartnerField>(
    field: Field,
    value: TradingPartnerFormValues[Field],
  ) {
    setValues((current) => ({ ...current, [field]: value }))
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitted(true)

    if ('errors' in result) {
      const first = Object.keys(result.errors)[0]
      formRef.current?.querySelector<HTMLElement>(`[name="${first}"]`)?.focus()

      return
    }

    save.mutate(result.input)
  }

  const ids = {
    name: `${baseId}-name`,
    gln: `${baseId}-gln`,
    characterSet: `${baseId}-character-set`,
    acknowledgementTimeLimitHours: `${baseId}-acknowledgement`,
  }

  const nameError = messageFor('name')
  const glnError = messageFor('gln')
  const hoursError = messageFor('acknowledgementTimeLimitHours')

  const characterSetItems = characterSets.map((characterSet) => ({
    value: characterSet,
    label: t(`characterSets.${characterSet}`),
  }))

  return (
    <form noValidate ref={formRef} className="flex max-w-xl flex-col gap-6" onSubmit={submit}>
      {!tradingPartner && (
        <p className="rounded-lg border border-amber-600/40 bg-amber-500/10 p-3 text-sm">
          {t('testModeNotice')}
        </p>
      )}
      <TextField
        id={ids.name}
        autoComplete="organization"
        description={t('fields.name.description')}
        error={nameError}
        label={t('fields.name.label')}
        name="name"
        value={values.name}
        onChange={(value) => update('name', value)}
      />
      <GlnField
        id={ids.gln}
        description={t('fields.gln.description')}
        error={glnError}
        label={t('fields.gln.label')}
        value={values.gln}
        onChange={(value) => update('gln', value)}
      />
      <SelectField
        id={ids.characterSet}
        description={t('fields.characterSet.description')}
        items={characterSetItems}
        label={t('fields.characterSet.label')}
        value={values.characterSet}
        onChange={(value) => update('characterSet', value)}
      />
      <TextField
        id={ids.acknowledgementTimeLimitHours}
        description={t('fields.acknowledgementTimeLimitHours.description')}
        error={hoursError}
        inputMode="numeric"
        label={t('fields.acknowledgementTimeLimitHours.label')}
        max={acknowledgementTimeLimitHours.max}
        min={acknowledgementTimeLimitHours.min}
        name="acknowledgementTimeLimitHours"
        step={1}
        type="number"
        value={values.acknowledgementTimeLimitHours}
        className="sm:w-32"
        onChange={(value) => update('acknowledgementTimeLimitHours', value)}
      />
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
      <div className="flex flex-wrap gap-2">
        <Button disabled={save.isPending} type="submit">
          {save.isPending ? t('saving') : tradingPartner ? t('save') : t('create')}
        </Button>
        <Link
          href={tradingPartner ? `/trading-partners/${tradingPartner.id}` : '/trading-partners'}
          className={buttonVariants({ variant: 'outline' })}>
          {t('cancel')}
        </Link>
      </div>
    </form>
  )
}
