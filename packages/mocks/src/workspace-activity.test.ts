import { describe, expect, it } from 'vitest'

import { createWorkspaceActivity } from './workspace-activity'

describe('createWorkspaceActivity', () => {
  it('falls back to any Trading Partner in production when none drew an overdue profile', () => {
    const { tradingPartners, overdueAcknowledgements } = createWorkspaceActivity({
      tradingPartnerCount: 1,
      overdueCount: 3,
      runCount: 0,
      seed: 1,
    })

    expect(tradingPartners[0]?.testMode).toBe(false)
    expect(overdueAcknowledgements.map(({ tradingPartner }) => tradingPartner.id)).toEqual(
      Array(3).fill(tradingPartners[0]?.id),
    )
  })

  it('leaves Test Mode Trading Partners without Overdue Acknowledgements', () => {
    const { tradingPartners, overdueAcknowledgements } = createWorkspaceActivity({
      tradingPartnerCount: 1,
      overdueCount: 3,
      runCount: 0,
      seed: 4,
    })

    expect(tradingPartners[0]?.testMode).toBe(true)
    expect(overdueAcknowledgements).toEqual([])
  })
})
