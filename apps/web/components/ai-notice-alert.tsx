'use client'

import { InformationCircleIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useId } from 'react'

import { Alert, AlertDescription, AlertTitle } from '@edi-bridge/ui/components/alert'

export function AiNoticeAlert({ title, message }: { title: string; message: string }) {
  const titleId = useId()

  return (
    <Alert role="status" aria-labelledby={titleId}>
      <HugeiconsIcon icon={InformationCircleIcon} strokeWidth={2} aria-hidden />
      <AlertTitle id={titleId}>{title}</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  )
}
