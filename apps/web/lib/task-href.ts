import type { TaskActor, TaskTarget } from '@edi-bridge/contracts'

import { documentHref, interchangeHref, navigationItems } from './navigation'

export const taskGroupIds = {
  you: 'for-you',
  retry: 'try-again',
  tradingPartner: 'waiting-for-partner',
} as const satisfies Record<TaskActor, string>

export const taskGroupHref = (whoActs: TaskActor) =>
  `${navigationItems.tasks.href}#${taskGroupIds[whoActs]}`

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
