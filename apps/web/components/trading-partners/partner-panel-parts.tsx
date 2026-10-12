import { CheckmarkCircle02Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { type ReactNode } from 'react'

import { Skeleton } from '@edi-bridge/ui/components/skeleton'

export function PanelLoading({ label }: { label: string }) {
  return (
    <div aria-busy className="flex flex-col gap-3">
      <p role="status" className="sr-only">
        {label}
      </p>
      <Skeleton className="h-6 w-56" />
      <Skeleton className="h-32 w-full rounded-lg" />
      <Skeleton className="h-32 w-full rounded-lg" />
    </div>
  )
}

export function StatusLine({ children }: { children: ReactNode }) {
  return (
    <p role="status" className="flex items-center gap-2 text-sm empty:hidden">
      {children && (
        <>
          <HugeiconsIcon
            icon={CheckmarkCircle02Icon}
            strokeWidth={2}
            aria-hidden
            className="text-success-text size-4 shrink-0"
          />
          {children}
        </>
      )}
    </p>
  )
}
