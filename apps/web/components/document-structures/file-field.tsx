'use client'

import { DocumentAttachmentIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useTranslations } from 'next-intl'
import { type DragEvent, useRef, useState } from 'react'

import { describedBy, FormField } from '@/components/form-field'
import { Input } from '@edi-bridge/ui/components/input'
import { cn } from '@edi-bridge/ui/lib/utils'

export function FileField({
  id,
  fileName,
  error,
  onChange,
}: {
  id: string
  fileName: string | null
  error: string | null
  onChange: (file: File) => void
}) {
  const t = useTranslations('DocumentStructureForm.file')
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
      description={t('description')}
      error={error}
      label={
        <label htmlFor={id} className="text-sm font-medium">
          {t('label')}
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
          {t('drop')}
        </p>
        <Input
          id={id}
          accept=".json,.csv,.txt,application/json,application/schema+json,text/csv,text/plain"
          name="file"
          ref={input}
          type="file"
          aria-describedby={describedBy(id, error)}
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
    </FormField>
  )
}
