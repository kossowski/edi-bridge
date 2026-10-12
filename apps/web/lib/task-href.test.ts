import { describe, expect, it } from 'vitest'

import { taskHref } from './task-href'

const id = '20000000-0000-4000-8000-000000000001'

describe('taskHref', () => {
  it.each([
    [{ kind: 'run', runId: id }, `/documents/${id}`],
    [{ kind: 'interchange', interchangeId: id }, `/interchanges/${id}`],
    [{ kind: 'tradingPartner', tradingPartnerId: id }, `/trading-partners/${id}`],
  ] as const)('links %o to the page with its fix', (target, href) => {
    expect(taskHref(target)).toBe(href)
  })
})
