import { eq } from 'drizzle-orm'
import { Effect } from 'effect'

import { workspaces } from '@edi-bridge/db'

import type { WorkspaceSettings, WorkspaceSettingsInput } from '@edi-bridge/contracts'

import { loadAiBudget } from './ai-budget.js'
import { Db } from './db.js'
import { exactlyOne } from './rows.js'
import { CurrentWorkspace } from './workspace.js'

export const loadWorkspaceSettings: Effect.Effect<WorkspaceSettings, never, CurrentWorkspace | Db> =
  Effect.gen(function* () {
    const db = yield* Db
    const { id } = yield* CurrentWorkspace

    const rows = yield* Effect.promise(() =>
      db
        .select({ documentRetentionDays: workspaces.documentRetentionDays })
        .from(workspaces)
        .where(eq(workspaces.id, id)),
    )

    const { documentRetentionDays } = yield* exactlyOne(rows)
    const { dailyLimit, usedToday } = yield* loadAiBudget

    return { documentRetentionDays, aiTokenBudget: { dailyLimit, usedToday } }
  })

export const updateWorkspaceSettings = ({
  documentRetentionDays,
  aiTokenBudget,
}: WorkspaceSettingsInput) =>
  Effect.gen(function* () {
    const db = yield* Db
    const { id } = yield* CurrentWorkspace

    yield* Effect.promise(() =>
      db
        .update(workspaces)
        .set({ documentRetentionDays, aiDailyTokenLimit: aiTokenBudget.dailyLimit })
        .where(eq(workspaces.id, id)),
    )

    return yield* loadWorkspaceSettings
  })
