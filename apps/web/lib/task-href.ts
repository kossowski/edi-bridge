import type { TaskTarget } from '@edi-bridge/contracts'

import { documentHref, interchangeHref } from './navigation'

export function taskHref(target: TaskTarget) {
  switch (target.kind) {
    case 'run': {
      return documentHref(target.runId)
    }

    case 'interchange': {
      return interchangeHref(target.controlReference)
    }

    case 'tradingPartner': {
      return `/trading-partners/${encodeURIComponent(target.tradingPartnerId)}`
    }
  }
}
