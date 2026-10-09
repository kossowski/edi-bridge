import {
  ArrowDataTransferHorizontalIcon,
  DashboardSquare01Icon,
  FlowConnectionIcon,
  PlayListIcon,
  PlugSocketIcon,
  Route01Icon,
  Settings02Icon,
  Table01Icon,
  UserMultiple02Icon,
  UserShield01Icon,
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
  mappings: { href: '/mappings', icon: FlowConnectionIcon },
  lookupTables: { href: '/lookup-tables', icon: Table01Icon },
  settings: { href: '/settings', icon: Settings02Icon },
  operator: { href: '/operator', icon: UserShield01Icon },
}

export const navigationGroups = [
  {
    label: 'workspaceGroup',
    items: [
      'overview',
      'runs',
      'orderLifecycle',
      'tradingPartners',
      'channels',
      'mappings',
      'lookupTables',
      'settings',
    ],
  },
  { label: 'platformGroup', items: ['operator'] },
] as const satisfies ReadonlyArray<{
  label: 'workspaceGroup' | 'platformGroup'
  items: ReadonlyArray<NavigationKey>
}>

export function isActivePath(pathname: string, href: string) {
  if (href === '/') {
    return pathname === '/'
  }

  return pathname === href || pathname.startsWith(`${href}/`)
}
