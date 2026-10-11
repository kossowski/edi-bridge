'use client'

import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Fragment } from 'react'

import { useBreadcrumbNames } from '@/hooks/use-breadcrumb-name'
import { breadcrumbTrail, type Crumb } from '@/lib/breadcrumb'
import {
  Breadcrumb,
  BreadcrumbEllipsis,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@edi-bridge/ui/components/breadcrumb'
import { Button } from '@edi-bridge/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@edi-bridge/ui/components/dropdown-menu'
import { cn } from '@edi-bridge/ui/lib/utils'

function useCrumbText() {
  const t = useTranslations()
  const names = useBreadcrumbNames()

  return ({ href, label }: Crumb) => {
    switch (label.kind) {
      case 'item':
        return t(`Sidebar.items.${label.key}.label`)
      case 'session':
        return t(`Shell.session.${label.key}`)
      case 'step':
        return t(`Breadcrumb.${label.key}`)
      case 'detail':
        return names.get(href) ?? t('Breadcrumb.details')
      case 'notFound':
        return t('NotFound.title')
    }
  }
}

function PathMenu({ crumbs, className }: { crumbs: ReadonlyArray<Crumb>; className: string }) {
  const t = useTranslations('Breadcrumb')
  const crumbText = useCrumbText()

  return (
    <>
      <BreadcrumbItem className={className}>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button size="icon-xs" variant="ghost" aria-label={t('showPath')} />}>
            <BreadcrumbEllipsis />
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-auto max-w-80">
            {crumbs.map((crumb) => (
              <DropdownMenuItem key={crumb.href} render={<Link href={crumb.href} />}>
                <span className="truncate">{crumbText(crumb)}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </BreadcrumbItem>
      <BreadcrumbSeparator className={className} />
    </>
  )
}

export function AppBreadcrumb() {
  const t = useTranslations('Breadcrumb')
  const crumbText = useCrumbText()
  const trail = breadcrumbTrail(usePathname())
  const ancestors = trail.slice(0, -1)
  const current = trail.at(-1)

  return (
    <Breadcrumb aria-label={t('label')} className="@container min-w-0 flex-1">
      <BreadcrumbList className="flex-nowrap">
        {ancestors.map((crumb, index) => (
          <Fragment key={crumb.href}>
            <BreadcrumbItem
              className={cn('hidden min-w-0', index === 0 ? '@xs:inline-flex' : '@lg:inline-flex')}>
              <BreadcrumbLink
                render={<Link href={crumb.href} />}
                className="focus-visible:ring-ring/50 max-w-48 truncate rounded-sm outline-none focus-visible:ring-[3px]">
                {crumbText(crumb)}
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator
              className={cn('hidden', index === 0 ? '@xs:block' : '@lg:block')}
            />
          </Fragment>
        ))}
        {ancestors.length > 0 && (
          <PathMenu
            crumbs={ancestors}
            className={ancestors.length > 1 ? '@lg:hidden' : '@xs:hidden'}
          />
        )}
        {current && (
          <BreadcrumbItem className="min-w-0">
            <BreadcrumbPage className="truncate">{crumbText(current)}</BreadcrumbPage>
          </BreadcrumbItem>
        )}
      </BreadcrumbList>
    </Breadcrumb>
  )
}
