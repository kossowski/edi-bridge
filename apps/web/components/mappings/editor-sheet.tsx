'use client'

import type { ComponentProps, ReactNode } from 'react'

import {
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@edi-bridge/ui/components/sheet'
import { cn } from '@edi-bridge/ui/lib/utils'

export function EditorSheetContent({
  title,
  description,
  closeLabel,
  className,
  bodyClassName,
  children,
  ...props
}: Omit<ComponentProps<typeof SheetContent>, 'title' | 'children'> & {
  title: string
  description: string
  closeLabel: string
  bodyClassName?: string
  children: ReactNode
}) {
  return (
    <SheetContent closeLabel={closeLabel} className={cn('w-full gap-0', className)} {...props}>
      <SheetHeader className="border-b pe-12">
        <SheetTitle className="text-lg">{title}</SheetTitle>
        <SheetDescription>{description}</SheetDescription>
      </SheetHeader>
      <div className={cn('flex min-h-0 flex-1 flex-col overflow-y-auto p-4', bodyClassName)}>
        {children}
      </div>
    </SheetContent>
  )
}
