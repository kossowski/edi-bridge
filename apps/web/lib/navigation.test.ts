import { describe, expect, it } from 'vitest'

import messages from '../messages/en.json'
import { accountMenuItems, sidebarItem, sidebarItems } from './navigation'

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
