import { describe, expect, it } from 'vitest'

import {
  awaitsReceiptConfirmation,
  dayTotals,
  receiptConfirmationPollInterval,
} from './partner-page-helpers'

describe('awaitsReceiptConfirmation', () => {
  const sent = { testInterchangeSentAt: '2026-10-10T08:00:00.000Z', contrlReceivedAt: null }

  it('waits after a test document without a receipt confirmation', () => {
    expect(awaitsReceiptConfirmation({ testMode: true, onboarding: sent })).toBe(true)
  })

  it('stops waiting once the receipt confirmation arrived', () => {
    expect(
      awaitsReceiptConfirmation({
        testMode: true,
        onboarding: { ...sent, contrlReceivedAt: '2026-10-10T08:05:00.000Z' },
      }),
    ).toBe(false)
  })

  it('does not wait before a test document is sent', () => {
    expect(
      awaitsReceiptConfirmation({
        testMode: true,
        onboarding: { testInterchangeSentAt: null, contrlReceivedAt: null },
      }),
    ).toBe(false)
  })

  it('does not wait for a live partner', () => {
    expect(awaitsReceiptConfirmation({ testMode: false, onboarding: sent })).toBe(false)
  })
})

describe('receiptConfirmationPollInterval', () => {
  const sent = { testInterchangeSentAt: '2026-10-10T08:00:00.000Z', contrlReceivedAt: null }

  it('checks every 10 seconds while the receipt confirmation is awaited', () => {
    expect(receiptConfirmationPollInterval({ testMode: true, onboarding: sent })).toBe(10_000)
  })

  it('stops checking once the receipt confirmation arrived', () => {
    expect(
      receiptConfirmationPollInterval({
        testMode: true,
        onboarding: { ...sent, contrlReceivedAt: '2026-10-10T08:05:00.000Z' },
      }),
    ).toBe(false)
  })

  it('does not check before the Trading Partner is loaded', () => {
    expect(receiptConfirmationPollInterval(undefined)).toBe(false)
  })
})

describe('dayTotals', () => {
  it('sums the documents and failures and finds the busiest day', () => {
    expect(
      dayTotals([
        { date: '2026-10-06', runs: 4, failed: 1 },
        { date: '2026-10-07', runs: 9, failed: 0 },
        { date: '2026-10-08', runs: 0, failed: 0 },
      ]),
    ).toEqual({ runs: 13, failed: 1, busiest: 9 })
  })

  it('is zero without any documents', () => {
    expect(dayTotals([])).toEqual({ runs: 0, failed: 0, busiest: 0 })
  })
})
