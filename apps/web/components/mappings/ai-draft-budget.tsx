'use client'

import { RefreshIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useQuery } from '@tanstack/react-query'
import { useFormatter, useTranslations } from 'next-intl'

import { budgetBlocksStart } from '@/components/mappings/ai-draft-run'
import { aiBudgetQuery } from '@/lib/api/queries'
import { Button } from '@edi-bridge/ui/components/button'
import { Skeleton } from '@edi-bridge/ui/components/skeleton'

import type { AiBudget } from '@edi-bridge/contracts'

function BudgetNotice({ budget, id }: { budget: AiBudget; id: string }) {
  const t = useTranslations('Mapping.aiDraft.budget')
  const format = useFormatter()

  if (budgetBlocksStart(budget)) {
    return (
      <p id={id} className="text-red-800 dark:text-red-300">
        {t(budget.dailyLimit === 0 ? 'turnedOff' : 'exhausted')}
      </p>
    )
  }

  return (
    <p id={id} className="text-muted-foreground">
      {t('remaining', {
        remaining: format.number(budget.dailyLimit - budget.usedToday),
        limit: format.number(budget.dailyLimit),
      })}
    </p>
  )
}

export function AiDraftBudget({ noticeId }: { noticeId: string }) {
  const t = useTranslations('Mapping.aiDraft.budget')
  const budget = useQuery(aiBudgetQuery)

  return (
    <div className="flex flex-col gap-1">
      <span className="font-medium">{t('label')}</span>
      {budget.isPending ? (
        <>
          <span role="status" className="sr-only">
            {t('loading')}
          </span>
          <Skeleton className="h-5 w-56" />
        </>
      ) : budget.isError ? (
        <p className="text-muted-foreground flex flex-wrap items-center gap-2">
          {t('error')}
          <Button size="sm" variant="outline" onClick={() => void budget.refetch()}>
            <HugeiconsIcon icon={RefreshIcon} strokeWidth={2} aria-hidden />
            {t('retry')}
          </Button>
        </p>
      ) : (
        <BudgetNotice id={noticeId} budget={budget.data} />
      )}
    </div>
  )
}
