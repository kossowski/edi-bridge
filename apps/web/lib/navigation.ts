import {
  ArrowDataTransferHorizontalIcon,
  DashboardSquare01Icon,
  File02Icon,
  FlowConnectionIcon,
  HelpCircleIcon,
  HierarchySquare02Icon,
  PlugSocketIcon,
  Rocket01Icon,
  Route01Icon,
  Settings02Icon,
  ShoppingBasket01Icon,
  Table01Icon,
  Task01Icon,
  UserMultiple02Icon,
  UserShield01Icon,
  WorkflowSquare03Icon,
} from '@hugeicons/core-free-icons'

import type { IconSvgElement } from '@hugeicons/react'
import type { Messages } from 'next-intl'

import type { FixTarget } from '@edi-bridge/contracts'

import type { SearchParamsReader } from './search-params'

export const documentViews = ['documents', 'transmissions'] as const

export type DocumentView = (typeof documentViews)[number]

export type NavigationKey = keyof Messages['Navigation']

type NavigationItem = {
  href: string
  icon: IconSvgElement
}

export const appIcon = ArrowDataTransferHorizontalIcon

export const navigationItems: Readonly<Record<NavigationKey, NavigationItem>> = {
  home: { href: '/', icon: DashboardSquare01Icon },
  tasks: { href: '/tasks', icon: Task01Icon },
  firstSteps: { href: '/first-steps', icon: Rocket01Icon },
  documents: { href: '/documents', icon: File02Icon },
  orders: { href: '/orders', icon: ShoppingBasket01Icon },
  tradingPartners: { href: '/trading-partners', icon: UserMultiple02Icon },
  channels: { href: '/channels', icon: PlugSocketIcon },
  flows: { href: '/flows', icon: WorkflowSquare03Icon },
  mappings: { href: '/mappings', icon: FlowConnectionIcon },
  documentStructures: { href: '/document-structures', icon: HierarchySquare02Icon },
  lookupTables: { href: '/lookup-tables', icon: Table01Icon },
  settings: { href: '/settings', icon: Settings02Icon },
  operator: { href: '/operator', icon: UserShield01Icon },
  help: { href: '/help', icon: HelpCircleIcon },
}

type AccountMenuItemKey = Extract<keyof Messages['Shell']['session'], 'settings' | 'operatorArea'>

type AccountMenuItem = NavigationItem & { key: AccountMenuItemKey }

type AccountMenuItemSource = { key: AccountMenuItemKey; page: NavigationKey; operatorOnly: boolean }

const accountMenuItemSources: ReadonlyArray<AccountMenuItemSource> = [
  { key: 'settings', page: 'settings', operatorOnly: false },
  { key: 'operatorArea', page: 'operator', operatorOnly: true },
]

export function accountMenuItems(operator: boolean): ReadonlyArray<AccountMenuItem> {
  return accountMenuItemSources.flatMap(({ key, page, operatorOnly }) =>
    operator || !operatorOnly ? [{ key, ...navigationItems[page] }] : [],
  )
}

export type SidebarItemKey = keyof Messages['Sidebar']['items']

type SidebarItemSource = {
  key: SidebarItemKey
  page: NavigationKey
  icon?: IconSvgElement
  search?: { view: DocumentView }
}

export type SidebarItem = NavigationItem & { key: SidebarItemKey }

type SidebarGroup = {
  key: keyof Messages['Sidebar']['groups']
  collapsible: boolean
  items: ReadonlyArray<SidebarItem>
}

type SidebarGroupSource = Omit<SidebarGroup, 'items'> & {
  items: ReadonlyArray<SidebarItemSource>
}

const sidebarGroupSources: ReadonlyArray<SidebarGroupSource> = [
  {
    key: 'dailyWork',
    collapsible: false,
    items: [
      { key: 'home', page: 'home' },
      { key: 'documents', page: 'documents' },
      { key: 'orders', page: 'orders' },
    ],
  },
  {
    key: 'setup',
    collapsible: false,
    items: [
      { key: 'tradingPartners', page: 'tradingPartners' },
      { key: 'mappings', page: 'mappings' },
      { key: 'codeTranslations', page: 'lookupTables' },
      { key: 'dataFormats', page: 'documentStructures' },
    ],
  },
  {
    key: 'advanced',
    collapsible: true,
    items: [
      { key: 'allConnections', page: 'channels' },
      { key: 'allDocumentRoutes', page: 'flows' },
      {
        key: 'transmissions',
        page: 'documents',
        icon: Route01Icon,
        search: { view: 'transmissions' },
      },
    ],
  },
]

function toSidebarItem({ key, page, icon, search }: SidebarItemSource): SidebarItem {
  const { href } = navigationItems[page]

  return {
    key,
    href: search ? `${href}?${new URLSearchParams(search)}` : href,
    icon: icon ?? navigationItems[page].icon,
  }
}

export const sidebarGroups: ReadonlyArray<SidebarGroup> = sidebarGroupSources.map((group) => ({
  ...group,
  items: group.items.map(toSidebarItem),
}))

const sidebarFooterSources: ReadonlyArray<SidebarItemSource> = [{ key: 'help', page: 'help' }]

export const sidebarFooterItems = sidebarFooterSources.map(toSidebarItem)

export const sidebarItems = [
  ...sidebarGroups.flatMap((group) => group.items),
  ...sidebarFooterItems,
]

export type PageItemKey = keyof Messages['Pages']

export type PageItem = NavigationItem & { key: PageItemKey }

export const pageItems: ReadonlyArray<PageItem> = [
  { key: 'tasks', ...navigationItems.tasks },
  { key: 'firstSteps', ...navigationItems.firstSteps },
]

export function sidebarItem(key: SidebarItemKey) {
  const item = sidebarItems.find((entry) => entry.key === key)

  if (!item) {
    throw new Error(`No sidebar item for ${key}`)
  }

  return item
}

export function activeSidebarItem(pathname: string, searchParams: SearchParamsReader) {
  let active: SidebarItem | undefined

  for (const item of sidebarItems) {
    if (
      isActiveHref(pathname, searchParams, item.href) &&
      (!active || item.href.length > active.href.length)
    ) {
      active = item
    }
  }

  return active?.key
}

function isActiveHref(pathname: string, searchParams: SearchParamsReader, href: string) {
  const [path = href, search = ''] = href.split('?')

  return (
    isActivePath(pathname, path) &&
    [...new URLSearchParams(search)].every(([name, value]) => searchParams.get(name) === value)
  )
}

function isActivePath(pathname: string, href: string) {
  if (href === '/') {
    return pathname === '/'
  }

  return pathname === href || pathname.startsWith(`${href}/`)
}

export function interchangeHref(controlReference: string) {
  const search = new URLSearchParams({ view: 'transmissions', q: controlReference })

  return `${navigationItems.documents.href}?${search}`
}

export function documentHref(id: string) {
  return `${navigationItems.documents.href}/${id}`
}

export function tradingPartnerHref(id: string) {
  return `${navigationItems.tradingPartners.href}/${id}`
}

export function flowHref(id: string) {
  return `${navigationItems.flows.href}/${id}`
}

export function mappingHref(id: string) {
  return `${navigationItems.mappings.href}/${id}`
}

export function orderHref(businessReference: string) {
  return `${navigationItems.orders.href}/${encodeURIComponent(businessReference)}`
}

export function fixTargetHref(target: FixTarget) {
  switch (target.kind) {
    case 'mapping': {
      const search = new URLSearchParams({ field: target.fieldPath })

      return `${mappingHref(target.mappingId)}?${search}`
    }

    case 'lookupTable': {
      const search = new URLSearchParams({ code: target.code })

      return `${navigationItems.lookupTables.href}/${target.lookupTableId}?${search}`
    }

    case 'channel': {
      return `${navigationItems.channels.href}/${target.channelId}`
    }

    case 'tradingPartner': {
      return tradingPartnerHref(target.tradingPartnerId)
    }
  }
}
