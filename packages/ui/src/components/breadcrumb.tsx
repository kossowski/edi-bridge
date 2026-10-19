import { mergeProps } from '@base-ui/react/merge-props'
import { useRender } from '@base-ui/react/use-render'
import { ArrowRight01Icon, MoreHorizontalCircle01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { cn } from 'cn'
import * as React from 'react'

function Breadcrumb({ className, ...props }: React.ComponentProps<'nav'>) {
  return <nav aria-label="breadcrumb" className={cn(className)} data-slot="breadcrumb" {...props} />
}

function BreadcrumbList({ className, ...props }: React.ComponentProps<'ol'>) {
  return (
    <ol
      className={cn(
        'text-muted-foreground flex flex-wrap items-center gap-1.5 text-sm wrap-break-word',
        className,
      )}
      data-slot="breadcrumb-list"
      {...props}
    />
  )
}

function BreadcrumbItem({ className, ...props }: React.ComponentProps<'li'>) {
  return (
    <li
      className={cn('inline-flex items-center gap-1', className)}
      data-slot="breadcrumb-item"
      {...props}
    />
  )
}

function BreadcrumbLink({ className, render, ...props }: useRender.ComponentProps<'a'>) {
  return useRender({
    defaultTagName: 'a',
    props: mergeProps<'a'>(
      {
        className: cn('hover:text-foreground transition-colors', className),
      },
      props,
    ),
    render,
    state: {
      slot: 'breadcrumb-link',
    },
  })
}

function BreadcrumbPage({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span
      role="link"
      aria-current="page"
      aria-disabled="true"
      className={cn('text-foreground font-normal', className)}
      data-slot="breadcrumb-page"
      {...props}
    />
  )
}

function BreadcrumbSeparator({ children, className, ...props }: React.ComponentProps<'li'>) {
  return (
    <li
      role="presentation"
      aria-hidden="true"
      className={cn('[&>svg]:size-3.5', className)}
      data-slot="breadcrumb-separator"
      {...props}>
      {children ?? <HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={2} />}
    </li>
  )
}

function BreadcrumbEllipsis({
  className,
  label,
  ...props
}: React.ComponentProps<'span'> & { label: string }) {
  return (
    <span
      role="presentation"
      aria-hidden="true"
      className={cn('flex size-5 items-center justify-center [&>svg]:size-4', className)}
      data-slot="breadcrumb-ellipsis"
      {...props}>
      <HugeiconsIcon icon={MoreHorizontalCircle01Icon} strokeWidth={2} />
      <span className="sr-only">{label}</span>
    </span>
  )
}

export {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
  BreadcrumbEllipsis,
}
