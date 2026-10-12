import type { FirstStepTarget } from '@edi-bridge/contracts'

import { navigationItems } from './navigation'

export function firstStepHref(target: FirstStepTarget) {
  switch (target.kind) {
    case 'companySettings': {
      return `${navigationItems.settings.href}?tab=company`
    }

    case 'newChannel': {
      return `${navigationItems.channels.href}/new`
    }

    case 'newTradingPartner': {
      return `${navigationItems.tradingPartners.href}/new`
    }

    case 'mappings': {
      return navigationItems.mappings.href
    }

    case 'tradingPartner': {
      return `${navigationItems.tradingPartners.href}/${encodeURIComponent(target.tradingPartnerId)}`
    }
  }
}
