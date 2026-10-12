'use client'

import { useFormatter, useTranslations } from 'next-intl'

import { budgetUsage } from '@/lib/forms/workspace-settings'
import { Alert, AlertDescription, AlertTitle } from '@edi-bridge/ui/components/alert'
import { Progress, ProgressLabel, ProgressValue } from '@edi-bridge/ui/components/progress'
import { cn } from '@edi-bridge/ui/lib/utils'

import type { AiTokenBudget } from '@edi-bridge/contracts'

export function BudgetUsage({ budget }: { budget: AiTokenBudget }) {
  const t = useTranslations('Settings.budgetUsage')
  const format = useFormatter()
  const usage = budgetUsage(budget)

  if (usage.turnedOff) {
    return (
      <Alert role={undefined}>
        <AlertTitle>{t('turnedOff.title')}</AlertTitle>
        <AlertDescription>{t('turnedOff.description')}</AlertDescription>
      </Alert>
    )
  }

  const percent = (share: number) =>
    format.number(share, { style: 'percent', maximumFractionDigits: 0 })

  const used = t('used', {
    used: format.number(budget.usedToday),
    limit: format.number(budget.dailyLimit),
    share: percent(usage.share),
  })

  return (
    <div className="flex flex-col gap-3">
      {usage.exhausted ? (
        <Alert role={undefined} className="border-red-700/40 bg-red-500/10">
          <AlertTitle>{t('exhausted.title')}</AlertTitle>
          <AlertDescription className="text-foreground">
            {t('exhausted.description')}
          </AlertDescription>
        </Alert>
      ) : (
        <p>
          {t.rich('left', {
            left: percent(1 - usage.share),
            strong: (chunks) => <strong>{chunks}</strong>,
          })}
        </p>
      )}
      <Progress
        getAriaValueText={() => used}
        max={1}
        value={usage.filled}
        className={cn(
          'gap-x-4 gap-y-2 *:data-[slot=progress-track]:h-2 *:data-[slot=progress-track]:border *:data-[slot=progress-track]:border-neutral-400 dark:*:data-[slot=progress-track]:border-neutral-500',
          usage.exhausted &&
            '**:data-[slot=progress-indicator]:bg-red-700 dark:**:data-[slot=progress-indicator]:bg-red-400',
        )}>
        <ProgressLabel className="text-muted-foreground font-normal">
          {t('usedLabel')}
        </ProgressLabel>
        <ProgressValue>{() => used}</ProgressValue>
      </Progress>
    </div>
  )
}
