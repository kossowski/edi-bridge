import { describe, expect, it } from 'vitest'

import {
  taskCountsOf,
  taskSchema,
  whoActsOnFailedRun,
  whoActsOnFailingTradingPartner,
} from './task'

const runId = '20000000-0000-4000-8000-000000000001'

const failedRunTask = {
  id: `run:${runId}`,
  kind: 'failedRun',
  whoActs: 'retry',
  tradingPartner: { id: '10000000-0000-4000-8000-000000000001', name: 'Hansemarkt GmbH' },
  at: '2026-10-10T09:00:00.000Z',
  run: { id: runId, messageType: 'INVOIC', failureStage: 'delivery' },
  target: { kind: 'run', runId },
}

describe('whoActsOnFailedRun', () => {
  it.each([
    ['delivery', 'INVOIC', 'retry'],
    ['delivery', 'ORDERS', 'retry'],
    ['mapping', 'ORDERS', 'you'],
    ['mapping', 'DESADV', 'you'],
    ['parse', 'ORDERS', 'tradingPartner'],
    ['validation', 'CONTRL', 'tradingPartner'],
    ['validation', 'INVOIC', 'you'],
  ] as const)('gives a Run that failed at %s with a %s to %s', (failureStage, messageType, who) => {
    expect(whoActsOnFailedRun({ failureStage, messageType, waitingForTradingPartner: false })).toBe(
      who,
    )
  })

  it.each(['delivery', 'mapping', 'validation'] as const)(
    'gives a Run that failed at %s and waits for a resend to the Trading Partner',
    (failureStage) => {
      expect(
        whoActsOnFailedRun({ failureStage, messageType: 'INVOIC', waitingForTradingPartner: true }),
      ).toBe('tradingPartner')
    },
  )
})

describe('taskSchema', () => {
  it('accepts a failed Run that links to its Run', () => {
    expect(taskSchema.parse(failedRunTask)).toEqual(failedRunTask)
  })

  it('rejects a free-form link instead of a typed target', () => {
    expect(
      taskSchema.safeParse({ ...failedRunTask, target: { kind: 'url', href: '/runs' } }).success,
    ).toBe(false)
  })

  it('rejects a target that does not fit the kind of task', () => {
    expect(
      taskSchema.safeParse({
        ...failedRunTask,
        target: { kind: 'tradingPartner', tradingPartnerId: failedRunTask.tradingPartner.id },
      }).success,
    ).toBe(false)
  })

  it('leaves an Overdue Acknowledgement to the Trading Partner', () => {
    expect(
      taskSchema.safeParse({
        id: 'overdue:1',
        kind: 'overdueAcknowledgement',
        whoActs: 'you',
        tradingPartner: failedRunTask.tradingPartner,
        at: '2026-10-10T09:00:00.000Z',
        interchange: { id: runId, controlReference: '4711' },
        messageType: 'DESADV',
        sentAt: '2026-10-09T09:00:00.000Z',
        acknowledgementTimeLimitHours: 24,
        target: { kind: 'interchange', controlReference: '4711' },
      }).success,
    ).toBe(false)
  })
})

describe('taskCountsOf', () => {
  it('counts the tasks per who acts', () => {
    expect(
      taskCountsOf([{ whoActs: 'you' }, { whoActs: 'tradingPartner' }, { whoActs: 'you' }]),
    ).toEqual({
      you: 2,
      retry: 0,
      tradingPartner: 1,
    })
  })
})

describe('whoActsOnFailingTradingPartner', () => {
  it.each([
    [['tradingPartner', 'tradingPartner', 'retry'], 'tradingPartner'],
    [['retry', 'retry', 'you'], 'retry'],
    [['retry', 'tradingPartner'], 'you'],
    [[], 'you'],
  ] as const)('gives open failed Runs acted on by %j to %s', (actors, expected) => {
    expect(whoActsOnFailingTradingPartner(actors.map((whoActs) => ({ whoActs })))).toBe(expected)
  })
})
