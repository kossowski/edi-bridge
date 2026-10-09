'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { type FormEvent, type ReactNode, useId, useRef, useState } from 'react'

import {
  type FieldError,
  toFormValues,
  type TradingPartnerField,
  type TradingPartnerFormValues,
  validateTradingPartnerForm,
} from '@/components/trading-partners/trading-partner-form-values'
import { ApiError, createTradingPartner, updateTradingPartner } from '@/lib/api/client'
import { tradingPartnerKeys, tradingPartnerQuery } from '@/lib/api/queries'
import {
  acknowledgementTimeLimitHours,
  characterSets,
  type TradingPartner,
  type TradingPartnerInput,
} from '@edi-bridge/contracts'
import { Button, buttonVariants } from '@edi-bridge/ui/components/button'
import { Input } from '@edi-bridge/ui/components/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@edi-bridge/ui/components/select'

function FormField({
  id,
  label,
  description,
  error,
  children,
}: {
  id: string
  label: ReactNode
  description: string
  error: string | null
  children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      {label}
      {children}
      <p id={`${id}-description`} className="text-muted-foreground text-sm">
        {description}
      </p>
      {error && (
        <p id={`${id}-error`} className="text-sm text-red-800 dark:text-red-300">
          {error}
        </p>
      )}
    </div>
  )
}

function describedBy(id: string, error: string | null) {
  return error ? `${id}-description ${id}-error` : `${id}-description`
}

export function useFieldErrorMessage() {
  const t = useTranslations('TradingPartnerForm.errors')

  return (field: TradingPartnerField, error: FieldError) => {
    switch (error) {
      case 'required':
        return t(`required.${field === 'gln' ? 'gln' : 'name'}`)
      case 'tooLong':
        return t('tooLong')
      case 'range':
        return t('range', acknowledgementTimeLimitHours)
      case 'format':
        return t('gln.format')
      case 'checkDigit':
        return t('gln.checkDigit')
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
      queryClient.setQueryData(tradingPartnerQuery(saved.id).queryKey, saved)
      void queryClient.invalidateQueries({ queryKey: tradingPartnerKeys.list() })
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
      <FormField
        id={ids.name}
        description={t('fields.name.description')}
        error={nameError}
        label={
          <label htmlFor={ids.name} className="text-sm font-medium">
            {t('fields.name.label')}
          </label>
        }>
        <Input
          id={ids.name}
          autoComplete="organization"
          name="name"
          value={values.name}
          aria-describedby={describedBy(ids.name, nameError)}
          aria-invalid={nameError !== null}
          onChange={(event) => update('name', event.target.value)}
        />
      </FormField>
      <FormField
        id={ids.gln}
        description={t('fields.gln.description')}
        error={glnError}
        label={
          <label htmlFor={ids.gln} className="text-sm font-medium">
            {t('fields.gln.label')}
          </label>
        }>
        <Input
          id={ids.gln}
          autoComplete="off"
          inputMode="numeric"
          name="gln"
          spellCheck={false}
          value={values.gln}
          aria-describedby={describedBy(ids.gln, glnError)}
          aria-invalid={glnError !== null}
          className="font-mono sm:w-60"
          onChange={(event) => update('gln', event.target.value)}
        />
      </FormField>
      <FormField
        id={ids.characterSet}
        description={t('fields.characterSet.description')}
        error={null}
        label={
          <span id={`${ids.characterSet}-label`} className="text-sm font-medium">
            {t('fields.characterSet.label')}
          </span>
        }>
        <Select
          items={characterSetItems}
          value={values.characterSet}
          onValueChange={(value) => {
            const characterSet = characterSets.find((item) => item === value)

            if (characterSet) {
              update('characterSet', characterSet)
            }
          }}>
          <SelectTrigger
            aria-describedby={`${ids.characterSet}-description`}
            aria-labelledby={`${ids.characterSet}-label`}
            className="w-full sm:w-80">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {characterSetItems.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FormField>
      <FormField
        id={ids.acknowledgementTimeLimitHours}
        description={t('fields.acknowledgementTimeLimitHours.description')}
        error={hoursError}
        label={
          <label htmlFor={ids.acknowledgementTimeLimitHours} className="text-sm font-medium">
            {t('fields.acknowledgementTimeLimitHours.label')}
          </label>
        }>
        <Input
          id={ids.acknowledgementTimeLimitHours}
          inputMode="numeric"
          max={acknowledgementTimeLimitHours.max}
          min={acknowledgementTimeLimitHours.min}
          name="acknowledgementTimeLimitHours"
          step={1}
          type="number"
          value={values.acknowledgementTimeLimitHours}
          aria-describedby={describedBy(ids.acknowledgementTimeLimitHours, hoursError)}
          aria-invalid={hoursError !== null}
          className="sm:w-32"
          onChange={(event) => update('acknowledgementTimeLimitHours', event.target.value)}
        />
      </FormField>
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
