import { describe, expect, it } from 'vitest'

import messages from '../messages/en.json'
import {
  accountMenuItems,
  activeSidebarItem,
  channelSettingsHref,
  documentHref,
  fixTargetHref,
  interchangeHref,
  newMappingHref,
  newMappingMessageTypeIn,
  orderHref,
  pageItems,
  sidebarItem,
  sidebarItems,
  tradingPartnerHref,
} from './navigation'

describe('sidebarItem', () => {
  it('finds an item for every sidebar label', () => {
    expect(sidebarItems.map((item) => item.key).toSorted()).toEqual(
      Object.keys(messages.Sidebar.items).toSorted(),
    )
    expect(sidebarItem('codeTranslations').href).toBe('/code-translations')
    expect(sidebarItem('help').href).toBe('/help')
  })
})

describe('pageItems', () => {
  it('keeps the pages outside the sidebar out of it', () => {
    expect(pageItems.map((item) => item.key).toSorted()).toEqual(
      Object.keys(messages.Pages).toSorted(),
    )
    expect(sidebarItems.map((item) => item.href)).not.toContain('/tasks')
    expect(sidebarItems.map((item) => item.href)).not.toContain('/first-steps')
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

  it('marks the orders on the list and on an order page', () => {
    expect(sidebarItem('orders').href).toBe('/orders')
    expect(activeSidebarItem('/orders', new URLSearchParams('status=done'))).toBe('orders')
    expect(activeSidebarItem('/orders/4711', new URLSearchParams())).toBe('orders')
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

describe('documentHref', () => {
  it('opens the document page', () => {
    expect(documentHref('run-1')).toBe('/documents/run-1')
  })
})

describe('channelSettingsHref', () => {
  it('opens the settings of the Channel', () => {
    expect(channelSettingsHref('channel-1')).toBe('/channels/channel-1/edit')
  })
})

describe('orderHref', () => {
  it('opens the order for the order number', () => {
    expect(orderHref('PO 4711/A')).toBe('/orders/PO%204711%2FA')
  })
})

describe('fixTargetHref', () => {
  it('opens the Mapping at the failing field', () => {
    expect(
      fixTargetHref({
        kind: 'mapping',
        mappingId: 'm-1',
        name: 'Invoices',
        fieldPath: 'lines[].gtin',
      }),
    ).toBe('/mappings/m-1?field=lines%5B%5D.gtin')
  })

  it('opens the Lookup Table with the missing code', () => {
    expect(
      fixTargetHref({ kind: 'lookupTable', lookupTableId: 't-1', name: 'Units', code: 'K&T' }),
    ).toBe('/code-translations/t-1?code=K%26T')
  })

  it('names the Run that stopped on the missing code', () => {
    expect(
      fixTargetHref(
        { kind: 'lookupTable', lookupTableId: 't-1', name: 'Units', code: 'KRT' },
        'r-1',
      ),
    ).toBe('/code-translations/t-1?code=KRT&run=r-1')
  })

  it('opens the Channel and the Trading Partner', () => {
    expect(fixTargetHref({ kind: 'channel', channelId: 'c-1', name: 'SFTP' })).toBe('/channels/c-1')
    expect(fixTargetHref({ kind: 'tradingPartner', tradingPartnerId: 'p-1', name: 'Acme' })).toBe(
      '/trading-partners/p-1',
    )
  })

  it('opens the settings screen of each incomplete setup piece', () => {
    expect(fixTargetHref({ kind: 'workspaceGln', name: 'Nordwind Foods' })).toBe('/settings')
    expect(
      fixTargetHref({ kind: 'tradingPartnerGln', tradingPartnerId: 'p-1', name: 'Acme' }),
    ).toBe('/trading-partners/p-1')
    expect(fixTargetHref({ kind: 'channelCredential', channelId: 'c-1', name: 'SFTP' })).toBe(
      '/channels/c-1',
    )
  })
})

describe('tradingPartnerHref', () => {
  it('opens the Trading Partner page', () => {
    expect(tradingPartnerHref('10000000-0000-4000-8000-000000000001')).toBe(
      '/trading-partners/10000000-0000-4000-8000-000000000001',
    )
  })
})

describe('newMappingHref', () => {
  it('opens the create step with the Message Type chosen', () => {
    expect(newMappingHref('DESADV')).toBe('/mappings?new=DESADV')
  })

  it('reads back the chosen Message Type and ignores any other value', () => {
    expect(newMappingMessageTypeIn({ new: 'DESADV' })).toBe('DESADV')
    expect(newMappingMessageTypeIn({ new: ['INVOIC', 'ORDERS'] })).toBe('INVOIC')
    expect(newMappingMessageTypeIn({ new: 'APERAK' })).toBeNull()
    expect(newMappingMessageTypeIn({})).toBeNull()
  })
})
