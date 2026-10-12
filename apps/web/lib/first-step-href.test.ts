import { describe, expect, it } from 'vitest'

import { firstStepHref } from './first-step-href'

const id = '10000000-0000-4000-8000-000000000001'

describe('firstStepHref', () => {
  it.each([
    [{ kind: 'companySettings' }, '/settings?tab=company'],
    [{ kind: 'newChannel' }, '/channels/new'],
    [{ kind: 'newTradingPartner' }, '/trading-partners/new'],
    [{ kind: 'mappings' }, '/mappings'],
    [{ kind: 'tradingPartner', tradingPartnerId: id }, `/trading-partners/${id}`],
  ] as const)('links %o to the page where the step is done', (target, href) => {
    expect(firstStepHref(target)).toBe(href)
  })
})
