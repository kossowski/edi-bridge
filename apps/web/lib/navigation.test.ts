import { describe, expect, it } from 'vitest'

import messages from '../messages/en.json'
import {
  accountMenuItems,
  activeSidebarItem,
  interchangeHref,
  sidebarItem,
  sidebarItems,
} from './navigation'

describe('sidebarItem', () => {
  it('finds an item for every sidebar label', () => {
    expect(sidebarItems.map((item) => item.key).toSorted()).toEqual(
      Object.keys(messages.Sidebar.items).toSorted(),
    )
    expect(sidebarItem('codeTranslations').href).toBe('/lookup-tables')
    expect(sidebarItem('help').href).toBe('/help')
  })
})

describe('accountMenuItems', () => {
  it('offers the Operator area to the Operator only', () => {
    expect(accountMenuItems(false).map((item) => item.href)).toEqual(['/settings'])
    expect(accountMenuItems(true).map((item) => item.href)).toEqual(['/settings', '/operator'])
  })
})

describe('activeSidebarItem', () => {
  it('marks the documents only in the documents view', () => {
    expect(activeSidebarItem('/documents', new URLSearchParams('status=done'))).toBe('documents')
    expect(activeSidebarItem('/documents', new URLSearchParams('view=transmissions&q=1'))).toBe(
      'transmissions',
    )
  })

  it('marks the longest matching path', () => {
    expect(activeSidebarItem('/', new URLSearchParams())).toBe('home')
    expect(activeSidebarItem('/flows/flow-1', new URLSearchParams())).toBe('allDocumentRoutes')
    expect(activeSidebarItem('/nowhere', new URLSearchParams())).toBeUndefined()
  })
})

describe('interchangeHref', () => {
  it('searches the transmissions for the control reference', () => {
    expect(interchangeHref('00123')).toBe('/documents?view=transmissions&q=00123')
    expect(sidebarItem('transmissions').href).toBe('/documents?view=transmissions')
  })
})
