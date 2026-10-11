import {
  ArrowDataTransferHorizontalIcon,
  DashboardSquare01Icon,
  File02Icon,
  FlowConnectionIcon,
  HierarchySquare02Icon,
  PlayListIcon,
  PlugSocketIcon,
  Route01Icon,
  Settings02Icon,
  ShoppingBasket01Icon,
  Table01Icon,
  UserMultiple02Icon,
  UserShield01Icon,
  WorkflowSquare03Icon,
} from '@hugeicons/core-free-icons'

import type { IconSvgElement } from '@hugeicons/react'
import type { Messages } from 'next-intl'

export type NavigationKey = keyof Messages['Navigation']

type NavigationItem = {
  href: string
  icon: IconSvgElement
}

export const appIcon = ArrowDataTransferHorizontalIcon

export const navigationItems: Readonly<Record<NavigationKey, NavigationItem>> = {
  overview: { href: '/', icon: DashboardSquare01Icon },
  runs: { href: '/runs', icon: PlayListIcon },
  orderLifecycle: { href: '/order-lifecycle', icon: Route01Icon },
  tradingPartners: { href: '/trading-partners', icon: UserMultiple02Icon },
  channels: { href: '/channels', icon: PlugSocketIcon },
  flows: { href: '/flows', icon: WorkflowSquare03Icon },
  mappings: { href: '/mappings', icon: FlowConnectionIcon },
  documentStructures: { href: '/document-structures', icon: HierarchySquare02Icon },
  lookupTables: { href: '/lookup-tables', icon: Table01Icon },
  settings: { href: '/settings', icon: Settings02Icon },
  operator: { href: '/operator', icon: UserShield01Icon },
}

export type SidebarItemKey = keyof Messages['Sidebar']['items']

type SidebarItem = NavigationItem & { key: SidebarItemKey }

type SidebarGroup = {
  key: keyof Messages['Sidebar']['groups']
  collapsible: boolean
  items: ReadonlyArray<SidebarItem>
}

export const sidebarGroups: ReadonlyArray<SidebarGroup> = [
  {
    key: 'dailyWork',
    collapsible: false,
    items: [
      { key: 'home', href: '/', icon: DashboardSquare01Icon },
      { key: 'documents', href: '/runs', icon: File02Icon },
      { key: 'orders', href: '/order-lifecycle', icon: ShoppingBasket01Icon },
    ],
  },
  {
    key: 'setup',
    collapsible: false,
    items: [
      { key: 'tradingPartners', href: '/trading-partners', icon: UserMultiple02Icon },
      { key: 'mappings', href: '/mappings', icon: FlowConnectionIcon },
      { key: 'codeTranslations', href: '/lookup-tables', icon: Table01Icon },
      { key: 'dataFormats', href: '/document-structures', icon: HierarchySquare02Icon },
    ],
  },
  {
    key: 'advanced',
    collapsible: true,
    items: [
      { key: 'allConnections', href: '/channels', icon: PlugSocketIcon },
      { key: 'allDocumentRoutes', href: '/flows', icon: WorkflowSquare03Icon },
      { key: 'transmissions', href: '/runs', icon: Route01Icon },
    ],
  },
]

export function activeSidebarItem(pathname: string) {
  let active: SidebarItem | undefined

  for (const item of sidebarGroups.flatMap((group) => group.items)) {
    if (isActivePath(pathname, item.href) && (!active || item.href.length > active.href.length)) {
      active = item
    }
  }

  return active?.key
}

export function isActivePath(pathname: string, href: string) {
  if (href === '/') {
    return pathname === '/'
  }

  return pathname === href || pathname.startsWith(`${href}/`)
}
