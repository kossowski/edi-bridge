'use client'

import { HugeiconsIcon } from '@hugeicons/react'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { appIcon, isActivePath, navigationGroups, navigationItems } from '@/lib/navigation'
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from '@edi-bridge/ui/components/sidebar'

export function AppSidebar() {
  const tShell = useTranslations('Shell')
  const tNavigation = useTranslations('Navigation')
  const pathname = usePathname()

  return (
    <Sidebar collapsible="icon" label={tShell('mainNavigation')}>
      <SidebarHeader>
        <div className="flex h-8 items-center gap-2 px-2 font-semibold">
          <HugeiconsIcon icon={appIcon} strokeWidth={2} className="size-4 shrink-0" />
          <span className="truncate group-data-[collapsible=icon]:hidden">{tShell('appName')}</span>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <nav aria-label={tShell('mainNavigation')}>
          {navigationGroups.map((group) => (
            <SidebarGroup key={group.label}>
              <SidebarGroupLabel>{tShell(group.label)}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {group.items.map((key) => {
                    const item = navigationItems[key]
                    const isActive = isActivePath(pathname, item.href)
                    const label = tNavigation(key)

                    return (
                      <SidebarMenuItem key={key}>
                        <SidebarMenuButton
                          isActive={isActive}
                          render={<Link href={item.href} />}
                          tooltip={label}
                          aria-current={isActive ? 'page' : undefined}>
                          <HugeiconsIcon icon={item.icon} strokeWidth={2} />
                          <span>{label}</span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    )
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ))}
        </nav>
      </SidebarContent>
      <SidebarRail title={tShell('toggleSidebar')} aria-label={tShell('toggleSidebar')} />
    </Sidebar>
  )
}
