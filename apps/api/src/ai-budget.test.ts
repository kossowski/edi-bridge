import { Effect } from 'effect'
import { TestClock } from 'effect/testing'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { aiBudgetEndpoint, aiBudgetSchema, aiDailyTokenLimit } from '@edi-bridge/contracts'
import { aiTokenUsage } from '@edi-bridge/db'

import { loadAiBudget, recordAiTokenUsage, requireAiBudget } from './ai-budget.js'
import { Db } from './db.js'
import { otherWorkspace, ownWorkspace, startTestApi, type TestApi } from './testing.js'
import { CurrentWorkspace } from './workspace.js'

let api: TestApi

beforeAll(async () => {
  api = await startTestApi()
}, 60_000)

afterAll(async () => {
  await api.stop()
})

beforeEach(async () => {
  await api.connection.db.delete(aiTokenUsage)
})

const inWorkspace =
  (workspaceId: string) =>
  <A, E>(effect: Effect.Effect<A, E, CurrentWorkspace | Db>) =>
    effect.pipe(
      Effect.provideService(CurrentWorkspace, { id: workspaceId }),
      Effect.provideService(Db, api.connection.db),
    )

const at =
  (iso: string) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    TestClock.setTime(Date.parse(iso)).pipe(
      Effect.andThen(effect),
      Effect.provide(TestClock.layer()),
    )

const record = (tokens: number, workspaceId = ownWorkspace.id) =>
  Effect.runPromise(recordAiTokenUsage(tokens).pipe(inWorkspace(workspaceId)))

const getBudget = (target = api.admin) =>
  target.inject({ method: aiBudgetEndpoint.method, url: aiBudgetEndpoint.path })

describe('GET /workspaces/current/ai-budget', () => {
  it('returns the default daily limit with nothing used today', async () => {
    const response = await getBudget()

    expect(response.statusCode).toBe(200)
    expect(aiBudgetSchema.parse(response.json())).toMatchObject({
      dailyLimit: 200_000,
      usedToday: 0,
    })
  })

  it('resets at the next midnight in UTC', async () => {
    const before = Date.now()
    const { resetsAt } = aiBudgetSchema.parse((await getBudget()).json())

    const reset = Date.parse(resetsAt)

    expect(reset).toBeGreaterThan(before)
    expect(reset - before).toBeLessThanOrEqual(24 * 60 * 60 * 1000)
    expect(resetsAt).toMatch(/T00:00:00\.000Z$/)
  })

  it('sums the tokens recorded today in the Workspace', async () => {
    await record(1200)
    await record(345)
    await record(9999, otherWorkspace.id)

    const response = await getBudget()

    expect(response.json()).toMatchObject({ usedToday: 1545 })
  })

  it('answers 403 to a Viewer', async () => {
    expect((await getBudget(api.viewer)).statusCode).toBe(403)
  })

  it('answers 401 without a session', async () => {
    expect((await getBudget(api.app)).statusCode).toBe(401)
  })
})

describe('AI token budget', () => {
  const inOwnWorkspace = inWorkspace(ownWorkspace.id)

  it('counts only the tokens recorded on the same day in UTC', async () => {
    await Effect.runPromise(
      recordAiTokenUsage(500).pipe(at('2026-10-18T23:59:59.000Z'), inOwnWorkspace),
    )
    await Effect.runPromise(
      recordAiTokenUsage(70).pipe(at('2026-10-19T00:00:00.000Z'), inOwnWorkspace),
    )

    const budget = await Effect.runPromise(
      loadAiBudget.pipe(at('2026-10-19T15:30:00.000Z'), inOwnWorkspace),
    )

    expect(budget).toEqual({
      dailyLimit: aiDailyTokenLimit.default,
      usedToday: 70,
      resetsAt: '2026-10-20T00:00:00.000Z',
    })
  })

  it('lets the Workspace draft while tokens are left', async () => {
    await record(199_999)

    await expect(Effect.runPromise(requireAiBudget.pipe(inOwnWorkspace))).resolves.toBeUndefined()
  })

  it('rejects once the daily limit is used up, with the budget', async () => {
    await record(150_000)
    await record(60_000)

    const error = await Effect.runPromise(Effect.flip(requireAiBudget).pipe(inOwnWorkspace))

    expect(error._tag).toBe('AiBudgetExhausted')
    expect(error.budget).toMatchObject({ dailyLimit: 200_000, usedToday: 210_000 })
  })

  it('keeps the budget of each Workspace apart', async () => {
    await record(200_000, otherWorkspace.id)

    await expect(Effect.runPromise(requireAiBudget.pipe(inOwnWorkspace))).resolves.toBeUndefined()
  })
})
