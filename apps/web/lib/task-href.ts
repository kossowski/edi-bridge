import type { TaskTarget } from '@edi-bridge/contracts'

import { documentHref } from './navigation'

export function taskHref(target: TaskTarget) {
  switch (target.kind) {
    case 'run': {
      return documentHref(target.runId)
    }

    case 'interchange': {
      return `/interchanges/${encodeURIComponent(target.interchangeId)}`
    }

    case 'tradingPartner': {
      return `/trading-partners/${encodeURIComponent(target.tradingPartnerId)}`
    }
  }
}
