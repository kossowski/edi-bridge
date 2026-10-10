'use client'

import { DocumentAttachmentIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useTranslations } from 'next-intl'
import { type DragEvent, useRef, useState } from 'react'

import { type FileMessage } from '@/components/document-structures/document-file'
import { describedBy, FormField } from '@/components/form-field'
import { Input } from '@edi-bridge/ui/components/input'
import { cn } from '@edi-bridge/ui/lib/utils'

const anyOrigin = '.json,.csv,.txt,application/json,application/schema+json,text/csv,text/plain'

export function FileField({
  id,
  fileName,
  message,
  onChange,
  label,
  description,
  accept = anyOrigin,
}: {
  id: string
  fileName: string | null
  message: FileMessage | null
  onChange: (file: File) => void
  label?: string
  description?: string
  accept?: string
}) {
  const t = useTranslations('DocumentStructureForm')
  const text = message && t(`errors.${message.key}`)
  const error = message?.invalid ? text : null
  const note = message && !message.invalid ? text : null
  const input = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  function drop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setDragging(false)
    const dropped = event.dataTransfer.files[0]

    if (dropped && input.current) {
      input.current.files = event.dataTransfer.files
      onChange(dropped)
    }
  }

  return (
    <FormField
      id={id}
      description={description ?? t('file.description')}
      error={error}
      label={
        <label htmlFor={id} className="text-sm font-medium">
          {label ?? t('file.label')}
        </label>
      }>
      <div
        className={cn(
          'flex flex-col items-center gap-2 rounded-lg border border-dashed p-4 text-center transition-colors',
          dragging && 'border-ring bg-muted',
        )}
        onDragLeave={() => setDragging(false)}
        onDragOver={(event) => {
          event.preventDefault()
          setDragging(true)
        }}
        onDrop={drop}>
        <HugeiconsIcon
          icon={DocumentAttachmentIcon}
          strokeWidth={2}
          aria-hidden
          className="text-muted-foreground size-6"
        />
        <p aria-hidden className="text-muted-foreground">
          {t('file.drop')}
        </p>
        <Input
          id={id}
          accept={accept}
          name="file"
          ref={input}
          type="file"
          aria-describedby={note ? `${describedBy(id, error)} ${id}-note` : describedBy(id, error)}
          aria-invalid={error !== null}
          className="h-auto py-1.5"
          onChange={(event) => {
            const chosen = event.target.files?.[0]

            if (chosen) {
              onChange(chosen)
            }
          }}
        />
        {fileName && (
          <p className="text-muted-foreground font-mono text-xs break-all">{fileName}</p>
        )}
      </div>
      {note && (
        <p id={`${id}-note`} className="text-sm font-medium">
          {note}
        </p>
      )}
    </FormField>
  )
}
