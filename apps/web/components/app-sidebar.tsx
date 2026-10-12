'use client'

import { ArrowDown01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { useState } from 'react'

import { AppBrand } from '@/components/app-brand'
import { AccountMenu } from '@/components/session/account-menu'
import { WorkspaceName } from '@/components/workspace-name'
import {
  activeSidebarItem,
  type SidebarItem,
  type SidebarItemKey,
  sidebarFooterItems,
  sidebarGroups,
} from '@/lib/navigation'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@edi-bridge/ui/components/collapsible'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from '@edi-bridge/ui/components/sidebar'

type GroupProps = {
  group: (typeof sidebarGroups)[number]
  activeKey: SidebarItemKey | undefined
}

function SidebarItemButton({
  item,
  activeKey,
}: {
  item: SidebarItem
  activeKey: SidebarItemKey | undefined
}) {
  const t = useTranslations('Sidebar.items')
  const { setOpenMobile } = useSidebar()
  const isActive = item.key === activeKey
  const label = t(`${item.key}.label`)

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={isActive}
        render={<Link href={item.href} />}
        tooltip={`${label}: ${t(`${item.key}.hint`)}`}
        aria-current={isActive ? 'page' : undefined}
        onClick={() => setOpenMobile(false)}>
        <HugeiconsIcon icon={item.icon} strokeWidth={2} />
        <span>{label}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}

function GroupMenu({ group, activeKey }: GroupProps) {
  return (
    <SidebarGroupContent>
      <SidebarMenu>
        {group.items.map((item) => (
          <SidebarItemButton key={item.key} activeKey={activeKey} item={item} />
        ))}
      </SidebarMenu>
    </SidebarGroupContent>
  )
}

function PlainGroup({ group, activeKey }: GroupProps) {
  const t = useTranslations('Sidebar.groups')

  return (
    <SidebarGroup>
      <SidebarGroupLabel>{t(group.key)}</SidebarGroupLabel>
      <GroupMenu activeKey={activeKey} group={group} />
    </SidebarGroup>
  )
}

function CollapsibleGroup({ group, activeKey }: GroupProps) {
  const t = useTranslations('Sidebar.groups')
  const { isMobile, state } = useSidebar()
  const containsActive = group.items.some((item) => item.key === activeKey)
  const [open, setOpen] = useState(containsActive)
  const [containedActive, setContainedActive] = useState(containsActive)

  if (containsActive !== containedActive) {
    setContainedActive(containsActive)

    if (containsActive) {
      setOpen(true)
    }
  }

  if (state === 'collapsed' && !isMobile) {
    return <PlainGroup activeKey={activeKey} group={group} />
  }

  return (
    <Collapsible open={open} className="group/collapsible" onOpenChange={setOpen}>
      <SidebarGroup>
        <SidebarGroupLabel
          render={<CollapsibleTrigger />}
          className="hover:bg-sidebar-accent hover:text-sidebar-accent-foreground w-full">
          {t(group.key)}
          <HugeiconsIcon
            icon={ArrowDown01Icon}
            strokeWidth={2}
            className="ml-auto transition-transform group-data-open/collapsible:rotate-180"
          />
        </SidebarGroupLabel>
        <CollapsibleContent>
          <GroupMenu activeKey={activeKey} group={group} />
        </CollapsibleContent>
      </SidebarGroup>
    </Collapsible>
  )
}

export function AppSidebar() {
  const tShell = useTranslations('Shell')
  const searchParams = useSearchParams()
  const activeKey = activeSidebarItem(usePathname(), searchParams)

  return (
    <Sidebar collapsible="icon" label={tShell('mainNavigation')}>
      <SidebarHeader>
        <AppBrand className="h-8 px-2" />
        <div className="px-2 group-data-[collapsible=icon]:hidden">
          <WorkspaceName />
        </div>
      </SidebarHeader>
      <SidebarContent>
        <nav aria-label={tShell('mainNavigation')}>
          {sidebarGroups.map((group) =>
            group.collapsible ? (
              <CollapsibleGroup key={group.key} activeKey={activeKey} group={group} />
            ) : (
              <PlainGroup key={group.key} activeKey={activeKey} group={group} />
            ),
          )}
        </nav>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          {sidebarFooterItems.map((item) => (
            <SidebarItemButton key={item.key} activeKey={activeKey} item={item} />
          ))}
        </SidebarMenu>
        <AccountMenu />
      </SidebarFooter>
      <SidebarRail label={tShell('toggleSidebar')} />
    </Sidebar>
  )
}
