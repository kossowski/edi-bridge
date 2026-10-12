import { describe, expect, it } from 'vitest'

import messages from '../messages/en.json'
import { sidebarItem, sidebarItems } from './navigation'

describe('sidebarItem', () => {
  it('finds an item for every sidebar label', () => {
    expect(sidebarItems.map((item) => item.key).toSorted()).toEqual(
      Object.keys(messages.Sidebar.items).toSorted(),
    )
    expect(sidebarItem('codeTranslations').href).toBe('/lookup-tables')
  })
})
