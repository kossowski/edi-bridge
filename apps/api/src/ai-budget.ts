import { and, eq, sql } from 'drizzle-orm'
import { Clock, Effect } from 'effect'

import { type AiBudget, aiBudgetExhausted } from '@edi-bridge/contracts'
import { aiTokenUsage, workspaces } from '@edi-bridge/db'

import { Db } from './db.js'
import { AiBudgetExhausted } from './errors.js'
import { exactlyOne } from './rows.js'
import { CurrentWorkspace } from './workspace.js'

const dayMillis = 24 * 60 * 60 * 1000

// The budget runs per day in UTC, so every installation resets at the same moment.
export const utcDay = (millis: number) => new Date(millis).toISOString().slice(0, 10)

const today = Effect.map(Clock.currentTimeMillis, (now) => {
  const start = now - (now % dayMillis)

  return { day: utcDay(start), resetsAt: new Date(start + dayMillis).toISOString() }
})

export const loadAiBudget: Effect.Effect<AiBudget, never, CurrentWorkspace | Db> = Effect.gen(
  function* () {
    const db = yield* Db
    const { id } = yield* CurrentWorkspace
    const { day, resetsAt } = yield* today

    const rows = yield* Effect.promise(() =>
      db
        .select({
          dailyLimit: workspaces.aiDailyTokenLimit,
          usedToday: sql<number>`coalesce(${aiTokenUsage.tokens}, 0)`.mapWith(Number),
        })
        .from(workspaces)
        .leftJoin(
          aiTokenUsage,
          and(eq(aiTokenUsage.workspaceId, workspaces.id), eq(aiTokenUsage.day, day)),
        )
        .where(eq(workspaces.id, id)),
    )

    const { dailyLimit, usedToday } = yield* exactlyOne(rows)

    return { dailyLimit, usedToday, resetsAt }
  },
)

export const requireAiBudget = Effect.gen(function* () {
  const budget = yield* loadAiBudget

  if (aiBudgetExhausted(budget)) {
    return yield* new AiBudgetExhausted({ budget })
  }
})

export const recordAiTokenUsage = (tokens: number) =>
  Effect.gen(function* () {
    const db = yield* Db
    const { id } = yield* CurrentWorkspace
    const { day } = yield* today

    yield* Effect.promise(() =>
      db
        .insert(aiTokenUsage)
        .values({ workspaceId: id, day, tokens })
        .onConflictDoUpdate({
          target: [aiTokenUsage.workspaceId, aiTokenUsage.day],
          set: { tokens: sql`${aiTokenUsage.tokens} + excluded.tokens` },
        }),
    )
  })

export const tokensOf = ({ totalTokens }: { totalTokens: number | undefined }) => totalTokens ?? 0
