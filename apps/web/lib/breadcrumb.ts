import {
  activeSidebarItem,
  navigationItems,
  type SidebarItemKey,
  sidebarItem,
  sidebarItems,
} from './navigation'

import type { SearchParamsReader } from './search-params'

const subpageKeys = ['new', 'edit', 'versions', 'compare'] as const

type SubpageKey = (typeof subpageKeys)[number]

export type CrumbLabel =
  | { kind: 'item'; key: SidebarItemKey }
  | { kind: 'session'; key: 'settings' | 'operatorArea' }
  | { kind: 'subpage'; key: SubpageKey }
  | { kind: 'detail' }
  | { kind: 'notFound' }

export type Crumb = { href: string; label: CrumbLabel }

type Section = { label: CrumbLabel; href: string; skip?: ReadonlyArray<string> }

function itemSection(key: SidebarItemKey): Section {
  return { label: { kind: 'item', key }, href: sidebarItem(key).href }
}

function sidebarSections() {
  const byFirstSegment = new Map<string, Section>()

  for (const item of sidebarItems) {
    const segment = item.href.split('?')[0]?.split('/').find(Boolean)

    if (segment !== undefined && !byFirstSegment.has(segment)) {
      byFirstSegment.set(segment, itemSection(item.key))
    }
  }

  return byFirstSegment
}

const sections = new Map<string, Section>([
  ...sidebarSections(),
  [
    'settings',
    { label: { kind: 'session', key: 'settings' }, href: navigationItems.settings.href },
  ],
  [
    'operator',
    {
      label: { kind: 'session', key: 'operatorArea' },
      href: navigationItems.operator.href,
      skip: ['workspaces'],
    },
  ],
])

function subpageKey(segment: string) {
  return subpageKeys.find((key) => key === segment)
}

export function breadcrumbTrail(
  pathname: string,
  searchParams: SearchParamsReader = new URLSearchParams(),
): ReadonlyArray<Crumb> {
  const [first, ...rest] = pathname.split('/').filter(Boolean)

  if (first === undefined) {
    return [itemSection('home')]
  }

  const active = rest.length === 0 ? activeSidebarItem(pathname, searchParams) : undefined
  const section = active ? itemSection(active) : sections.get(first)

  if (!section) {
    return [{ href: pathname, label: { kind: 'notFound' } }]
  }

  const trail: Array<Crumb> = [{ href: section.href, label: section.label }]
  let path = `/${first}`

  for (const segment of rest) {
    path = `${path}/${segment}`

    if (section.skip?.includes(segment)) {
      continue
    }

    const key = subpageKey(segment)

    trail.push({ href: path, label: key ? { kind: 'subpage', key } : { kind: 'detail' } })
  }

  return trail
}

export function detailCrumbHref(pathname: string) {
  return breadcrumbTrail(pathname).findLast((crumb) => crumb.label.kind === 'detail')?.href
}
