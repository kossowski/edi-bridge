import { describe, expect, it } from 'vitest'

import { breadcrumbTrail, detailCrumbHref } from './breadcrumb'

describe('breadcrumbTrail', () => {
  it('names the home page', () => {
    expect(breadcrumbTrail('/')).toEqual([{ href: '/', label: { kind: 'item', key: 'home' } }])
  })

  it('uses the on-screen label for a section', () => {
    expect(breadcrumbTrail('/code-translations')).toEqual([
      { href: '/code-translations', label: { kind: 'item', key: 'codeTranslations' } },
    ])
  })

  it('names the help page', () => {
    expect(breadcrumbTrail('/help')).toEqual([
      { href: '/help', label: { kind: 'item', key: 'help' } },
    ])
  })

  it('names the tasks page', () => {
    expect(breadcrumbTrail('/tasks')).toEqual([
      { href: '/tasks', label: { kind: 'page', key: 'tasks' } },
    ])
  })

  it('names the first steps page', () => {
    expect(breadcrumbTrail('/first-steps')).toEqual([
      { href: '/first-steps', label: { kind: 'page', key: 'firstSteps' } },
    ])
  })

  it('adds a detail crumb and the subpages below it', () => {
    expect(breadcrumbTrail('/flows/fl-1/edit')).toEqual([
      { href: '/flows', label: { kind: 'item', key: 'allDocumentRoutes' } },
      { href: '/flows/fl-1', label: { kind: 'detail' } },
      { href: '/flows/fl-1/edit', label: { kind: 'subpage', key: 'edit' } },
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

  it('names the Transmissions view of the documents', () => {
    expect(breadcrumbTrail('/documents', new URLSearchParams({ view: 'transmissions' }))).toEqual([
      { href: '/documents?view=transmissions', label: { kind: 'item', key: 'transmissions' } },
    ])
  })

  it('puts a document under the documents', () => {
    expect(breadcrumbTrail('/documents/run-1')).toEqual([
      { href: '/documents', label: { kind: 'item', key: 'documents' } },
      { href: '/documents/run-1', label: { kind: 'detail' } },
    ])
  })

  it('puts an order under the orders', () => {
    expect(breadcrumbTrail('/orders/4711')).toEqual([
      { href: '/orders', label: { kind: 'item', key: 'orders' } },
      { href: '/orders/4711', label: { kind: 'detail' } },
    ])
  })

  it('leaves out segments without a page of their own', () => {
    expect(breadcrumbTrail('/operator/workspaces/ws-1')).toEqual([
      { href: '/operator', label: { kind: 'session', key: 'operatorArea' } },
      { href: '/operator/workspaces/ws-1', label: { kind: 'detail' } },
    ])
  })

  it('leads from a version comparison back to the mapping editor', () => {
    expect(breadcrumbTrail('/mappings/m-1/versions/compare')).toEqual([
      { href: '/mappings', label: { kind: 'item', key: 'mappings' } },
      { href: '/mappings/m-1', label: { kind: 'detail' } },
      { href: '/mappings/m-1/versions/compare', label: { kind: 'subpage', key: 'compare' } },
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
