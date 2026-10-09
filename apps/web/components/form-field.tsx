'use client'

import { useTranslations } from 'next-intl'

import type { ReactNode } from 'react'

import { Input } from '@edi-bridge/ui/components/input'

import type { GlnError } from '@/lib/forms/gln'

export function FormField({
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

export function describedBy(id: string, error: string | null) {
  return error ? `${id}-description ${id}-error` : `${id}-description`
}

export function useGlnErrorMessage() {
  const t = useTranslations('GlnField.errors')

  return (error: GlnError) => t(error)
}

export function GlnField({
  id,
  label,
  description,
  value,
  error,
  onChange,
}: {
  id: string
  label: string
  description: string
  value: string
  error: string | null
  onChange: (value: string) => void
}) {
  return (
    <FormField
      id={id}
      description={description}
      error={error}
      label={
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
      }>
      <Input
        id={id}
        autoComplete="off"
        inputMode="numeric"
        name="gln"
        spellCheck={false}
        value={value}
        aria-describedby={describedBy(id, error)}
        aria-invalid={error !== null}
        className="font-mono sm:w-60"
        onChange={(event) => onChange(event.target.value)}
      />
    </FormField>
  )
}
