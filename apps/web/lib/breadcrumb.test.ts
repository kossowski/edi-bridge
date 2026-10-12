import { describe, expect, it } from 'vitest'

import { breadcrumbTrail, detailCrumbHref } from './breadcrumb'

describe('breadcrumbTrail', () => {
  it('names the home page', () => {
    expect(breadcrumbTrail('/')).toEqual([{ href: '/', label: { kind: 'item', key: 'home' } }])
  })

  it('uses the on-screen label for a section', () => {
    expect(breadcrumbTrail('/lookup-tables')).toEqual([
      { href: '/lookup-tables', label: { kind: 'item', key: 'codeTranslations' } },
    ])
  })

  it('names the help page', () => {
    expect(breadcrumbTrail('/help')).toEqual([
      { href: '/help', label: { kind: 'item', key: 'help' } },
    ])
  })

  it('adds a detail crumb and the subpages below it', () => {
    expect(breadcrumbTrail('/trading-partners/tp-1/edit')).toEqual([
      { href: '/trading-partners', label: { kind: 'item', key: 'tradingPartners' } },
      { href: '/trading-partners/tp-1', label: { kind: 'detail' } },
      { href: '/trading-partners/tp-1/edit', label: { kind: 'subpage', key: 'edit' } },
    ])
    expect(breadcrumbTrail('/channels/new')).toEqual([
      { href: '/channels', label: { kind: 'item', key: 'allConnections' } },
      { href: '/channels/new', label: { kind: 'subpage', key: 'new' } },
    ])
  })

  it('names a page with two sidebar items after the first one', () => {
    expect(breadcrumbTrail('/documents')).toEqual([
      { href: '/documents', label: { kind: 'item', key: 'documents' } },
    ])
  })

  it('puts a Run under the documents', () => {
    expect(breadcrumbTrail('/runs/run-1')).toEqual([
      { href: '/documents', label: { kind: 'item', key: 'documents' } },
      { href: '/runs/run-1', label: { kind: 'detail' } },
    ])
  })

  it('leaves out segments without a page of their own', () => {
    expect(breadcrumbTrail('/operator/workspaces/ws-1')).toEqual([
      { href: '/operator', label: { kind: 'session', key: 'operatorArea' } },
      { href: '/operator/workspaces/ws-1', label: { kind: 'detail' } },
    ])
  })

  it('names an unknown route as not found', () => {
    expect(breadcrumbTrail('/nowhere/at-all')).toEqual([
      { href: '/nowhere/at-all', label: { kind: 'notFound' } },
    ])
  })
})

describe('detailCrumbHref', () => {
  it('finds the detail crumb below the current page', () => {
    expect(detailCrumbHref('/mappings/m-1/versions/compare')).toBe('/mappings/m-1')
    expect(detailCrumbHref('/mappings')).toBeUndefined()
  })
})
