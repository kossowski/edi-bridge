import Link from 'next/link'

import type { ComponentProps } from 'react'

import { cn } from '@edi-bridge/ui/lib/utils'

export function LinkCard({ className, ...props }: ComponentProps<typeof Link>) {
  return (
    <Link
      className={cn(
        'bg-card hover:bg-muted/50 focus-visible:ring-ring/50 flex flex-col rounded-xl border outline-none focus-visible:ring-3',
        className,
      )}
      {...props}
    />
  )
}
