import { AlertCircleIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'

import { Button } from '@edi-bridge/ui/components/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@edi-bridge/ui/components/empty'

export function LoadError({
  title,
  description,
  retryLabel,
  onRetry,
}: {
  title: string
  description: string
  retryLabel: string
  onRetry: () => void
}) {
  return (
    <Empty className="border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <HugeiconsIcon icon={AlertCircleIcon} strokeWidth={2} />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button variant="outline" onClick={onRetry}>
          {retryLabel}
        </Button>
      </EmptyContent>
    </Empty>
  )
}
