import type { Messages } from 'next-intl'

import { navigationItems, type SidebarItemKey, sidebarGroups } from './navigation'

type StepKey = keyof Omit<Messages['Breadcrumb'], 'label' | 'showPath' | 'details'>

export type CrumbLabel =
  | { kind: 'item'; key: SidebarItemKey }
  | { kind: 'session'; key: 'settings' | 'operatorArea' }
  | { kind: 'step'; key: StepKey }
  | { kind: 'detail' }
  | { kind: 'notFound' }

export type Crumb = { href: string; label: CrumbLabel }

type Section = { label: CrumbLabel; href: string; skip?: ReadonlyArray<string> }

function sidebarSection(key: SidebarItemKey): Section {
  const item = sidebarGroups.flatMap((group) => group.items).find((entry) => entry.key === key)

  return { label: { kind: 'item', key }, href: item?.href ?? '/' }
}

const sections = new Map<string, Section>([
  ['runs', sidebarSection('documents')],
  ['order-lifecycle', sidebarSection('orders')],
  ['trading-partners', sidebarSection('tradingPartners')],
  ['mappings', sidebarSection('mappings')],
  ['lookup-tables', sidebarSection('codeTranslations')],
  ['document-structures', sidebarSection('dataFormats')],
  ['channels', sidebarSection('allConnections')],
  ['flows', sidebarSection('allDocumentRoutes')],
  ['interchanges', sidebarSection('transmissions')],
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

const steps = new Set<string>(['new', 'edit', 'versions', 'compare'])

function isStep(segment: string): segment is StepKey {
  return steps.has(segment)
}

export function breadcrumbTrail(pathname: string): ReadonlyArray<Crumb> {
  const [first, ...rest] = pathname.split('/').filter(Boolean)

  if (first === undefined) {
    return [sidebarSection('home')]
  }

  const section = sections.get(first)

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

    trail.push({
      href: path,
      label: isStep(segment) ? { kind: 'step', key: segment } : { kind: 'detail' },
    })
  }

  return trail
}

export function detailCrumbHref(pathname: string) {
  return breadcrumbTrail(pathname).findLast((crumb) => crumb.label.kind === 'detail')?.href
}
