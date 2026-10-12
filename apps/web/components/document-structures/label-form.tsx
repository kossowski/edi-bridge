'use client'

import { type ReactNode, useState } from 'react'

import { isBlank } from '@/components/document-structures/new-document-structure'
import { TextField } from '@/components/form-field'
import { maxFieldLabelLength } from '@edi-bridge/contracts'

export function LabelForm({
  id,
  label,
  value,
  required,
  busy = false,
  onChange,
  onSubmit,
  actions,
  children,
}: {
  id: string
  label: string
  value: string
  required: string
  busy?: boolean
  onChange: (value: string) => void
  onSubmit: (label: string) => void
  actions: ReactNode
  children?: ReactNode
}) {
  const [touched, setTouched] = useState(false)

  return (
    <form
      noValidate
      aria-busy={busy || undefined}
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault()
        setTouched(true)

        if (isBlank(value)) {
          document.getElementById(id)?.focus()

          return
        }

        onSubmit(value.trim())
      }}>
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1 basis-48">
          <TextField
            id={id}
            error={touched && isBlank(value) ? required : null}
            label={label}
            maxLength={maxFieldLabelLength}
            value={value}
            onChange={onChange}
          />
        </div>
        <div className="flex flex-wrap gap-2">{actions}</div>
      </div>
      {children}
    </form>
  )
}
