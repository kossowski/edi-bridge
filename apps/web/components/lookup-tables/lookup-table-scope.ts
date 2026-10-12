import { Building03Icon, UserMultiple02Icon } from '@hugeicons/core-free-icons'

import type { IconSvgElement } from '@hugeicons/react'

import type { LookupTableScope, LookupTableScopeInput } from '@edi-bridge/contracts'

export const workspaceScopeKey = 'workspace'

export const scopeIcons = {
  workspace: Building03Icon,
  tradingPartner: UserMultiple02Icon,
} as const satisfies Record<LookupTableScope['kind'], IconSvgElement>

export function scopeKey(scope: LookupTableScope | LookupTableScopeInput) {
  if (scope.kind === 'workspace') {
    return workspaceScopeKey
  }

  return 'tradingPartner' in scope ? scope.tradingPartner.id : scope.tradingPartnerId
}

export function toScopeInput(scope: LookupTableScope): LookupTableScopeInput {
  return scope.kind === 'workspace'
    ? { kind: 'workspace' }
    : { kind: 'tradingPartner', tradingPartnerId: scope.tradingPartner.id }
}

export function scopeInputOf(
  kind: LookupTableScopeInput['kind'],
  tradingPartnerId: string | null,
): LookupTableScopeInput | null {
  if (kind === 'workspace') {
    return { kind: 'workspace' }
  }

  return tradingPartnerId === null ? null : { kind: 'tradingPartner', tradingPartnerId }
}
