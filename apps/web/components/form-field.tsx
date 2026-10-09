'use client'

import { useTranslations } from 'next-intl'

import type { ComponentProps, ReactNode } from 'react'

import { Input } from '@edi-bridge/ui/components/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@edi-bridge/ui/components/select'
import { Textarea } from '@edi-bridge/ui/components/textarea'

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

type FieldProps = {
  id: string
  label: string
  description: string
  error: string | null
  value: string
  onChange: (value: string) => void
}

function LabelledField({
  id,
  label,
  description,
  error,
  children,
}: Omit<FieldProps, 'value' | 'onChange'> & { children: ReactNode }) {
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
      {children}
    </FormField>
  )
}

export function TextField({
  id,
  label,
  description,
  error,
  value,
  onChange,
  ...inputProps
}: FieldProps & Omit<ComponentProps<'input'>, 'id' | 'value' | 'onChange'>) {
  return (
    <LabelledField id={id} description={description} error={error} label={label}>
      <Input
        id={id}
        value={value}
        aria-describedby={describedBy(id, error)}
        aria-invalid={error !== null}
        onChange={(event) => onChange(event.target.value)}
        {...inputProps}
      />
    </LabelledField>
  )
}

export function TextareaField({
  id,
  label,
  description,
  error,
  value,
  onChange,
  ...textareaProps
}: FieldProps & Omit<ComponentProps<'textarea'>, 'id' | 'value' | 'onChange'>) {
  return (
    <LabelledField id={id} description={description} error={error} label={label}>
      <Textarea
        id={id}
        value={value}
        aria-describedby={describedBy(id, error)}
        aria-invalid={error !== null}
        onChange={(event) => onChange(event.target.value)}
        {...textareaProps}
      />
    </LabelledField>
  )
}

export function SelectField<Value extends string>({
  id,
  label,
  description,
  value,
  items,
  onChange,
  placeholder,
  error = null,
  disabled = false,
}: {
  id: string
  label: string
  description: string
  value: Value | null
  items: ReadonlyArray<{ value: Value; label: string }>
  onChange: (value: Value) => void
  placeholder?: string
  error?: string | null
  disabled?: boolean
}) {
  return (
    <FormField
      id={id}
      description={description}
      error={error}
      label={
        <span id={`${id}-label`} className="text-sm font-medium">
          {label}
        </span>
      }>
      <Select
        disabled={disabled}
        items={items}
        // Until its items load, Base UI would show the raw value, e.g. an ID.
        value={items.some((item) => item.value === value) ? value : null}
        onValueChange={(next) => {
          const item = items.find((candidate) => candidate.value === next)

          if (item) {
            onChange(item.value)
          }
        }}>
        <SelectTrigger
          id={id}
          aria-describedby={describedBy(id, error)}
          aria-invalid={error !== null}
          aria-labelledby={`${id}-label`}
          className="w-full sm:w-80">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FormField>
  )
}

export function Fieldset({ legend, children }: { legend: string; children: ReactNode }) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-6 border-t pt-4">
      <legend className="pr-2 font-semibold">{legend}</legend>
      {children}
    </fieldset>
  )
}

export function useGlnErrorMessage() {
  const t = useTranslations('GlnField.errors')

  return (error: GlnError) => t(error)
}

export function GlnField(props: FieldProps) {
  return (
    <TextField
      {...props}
      autoComplete="off"
      inputMode="numeric"
      name="gln"
      spellCheck={false}
      className="font-mono sm:w-60"
    />
  )
}
