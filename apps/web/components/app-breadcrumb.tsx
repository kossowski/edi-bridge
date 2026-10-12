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
      case 'subpage':
        return t(`Breadcrumb.${label.key}`)
      case 'detail':
        return names.get(href) ?? t('Breadcrumb.details')
      case 'notFound':
        return t('NotFound.title')
    }
  }
}

function shownFrom(index: number) {
  return index === 0
    ? { crumb: 'hidden @xs:inline-flex', separator: 'hidden @xs:block', hidden: '@xs:hidden' }
    : { crumb: 'hidden @lg:inline-flex', separator: 'hidden @lg:block', hidden: '@lg:hidden' }
}

function pathMenuStarts(count: number) {
  return Array.from({ length: count }, (_, index) => index).filter(
    (index) => index === 0 || shownFrom(index).hidden !== shownFrom(index - 1).hidden,
  )
}

function PathMenu({ crumbs, firstHidden }: { crumbs: ReadonlyArray<Crumb>; firstHidden: number }) {
  const t = useTranslations('Breadcrumb')
  const crumbText = useCrumbText()
  const shownBefore = firstHidden > 0 ? shownFrom(firstHidden - 1) : undefined
  const hiddenFrom = shownFrom(firstHidden).hidden

  return (
    <>
      <BreadcrumbItem className={cn(shownBefore?.crumb, hiddenFrom)}>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button size="icon-xs" variant="ghost" aria-label={t('showPath')} />}>
            <BreadcrumbEllipsis />
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-auto max-w-80">
            {crumbs.slice(firstHidden).map((crumb) => (
              <DropdownMenuItem key={crumb.href} render={<Link href={crumb.href} />}>
                <span className="truncate">{crumbText(crumb)}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </BreadcrumbItem>
      <BreadcrumbSeparator className={cn(shownBefore?.separator, hiddenFrom)} />
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
            <BreadcrumbItem className={cn('min-w-0', shownFrom(index).crumb)}>
              <BreadcrumbLink
                render={<Link href={crumb.href} />}
                className="focus-visible:ring-ring/50 max-w-48 truncate rounded-sm outline-none focus-visible:ring-[3px]">
                {crumbText(crumb)}
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator className={shownFrom(index).separator} />
          </Fragment>
        ))}
        {pathMenuStarts(ancestors.length).map((firstHidden) => (
          <PathMenu key={firstHidden} crumbs={ancestors} firstHidden={firstHidden} />
        ))}
        {current && (
          <BreadcrumbItem className="min-w-0">
            <BreadcrumbPage className="truncate">{crumbText(current)}</BreadcrumbPage>
          </BreadcrumbItem>
        )}
      </BreadcrumbList>
    </Breadcrumb>
  )
}
