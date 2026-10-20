import type { AiBudget } from '@edi-bridge/contracts'

import type { WorkspaceSettingsStore } from './workspace-settings'

function nextMidnight(now: Date) {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
  ).toISOString()
}

export function aiBudgetOf(
  settings: WorkspaceSettingsStore,
  workspaceId: string,
  { exhausted }: { exhausted: boolean },
): AiBudget {
  const { dailyLimit, usedToday } = settings.get(workspaceId).aiTokenBudget

  return {
    dailyLimit,
    usedToday: exhausted ? Math.max(dailyLimit, usedToday) : usedToday,
    resetsAt: nextMidnight(new Date()),
  }
}
