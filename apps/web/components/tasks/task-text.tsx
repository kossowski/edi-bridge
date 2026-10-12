'use client'

import { Alert02Icon, Clock01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useTranslations } from 'next-intl'

import { usePlainNames } from '@/components/plain-names'
import { Term } from '@/components/term'
import { directionOf, type Task } from '@edi-bridge/contracts'

export function useTaskText({ glossaryLinks = true }: { glossaryLinks?: boolean } = {}) {
  const t = useTranslations('Tasks')
  const plainNames = usePlainNames()

  return (task: Task) => {
    const partner = task.tradingPartner.name

    switch (task.kind) {
      case 'failedRun': {
        return {
          title: plainNames.failureStageTitle(task.run.failureStage),
          detail: t('failedRun.detail', {
            direction: directionOf(task.run),
            messageType: plainNames.messageTypeName(task.run.messageType),
            partner,
          }),
          action: t(`failedRun.action.${task.whoActs}`),
        }
      }

      case 'overdueAcknowledgement': {
        return {
          title: t('overdueAcknowledgement.title', { partner }),
          detail: t.rich('overdueAcknowledgement.detail', {
            messageType: plainNames.messageTypeName(task.messageType),
            controlReference: task.interchange.controlReference,
            hours: task.acknowledgementTimeLimitHours,
            term: (chunks) =>
              glossaryLinks ? <Term glossaryKey="acknowledgement">{chunks}</Term> : chunks,
          }),
          action: t('overdueAcknowledgement.action'),
        }
      }

      case 'failingTradingPartner': {
        return {
          title: t('failingTradingPartner.title', { partner }),
          detail: t('failingTradingPartner.detail', {
            failed: task.failed,
            total: task.delivered + task.failed,
          }),
          action: t('failingTradingPartner.action'),
        }
      }
    }
  }
}

export function TaskIcon({ task }: { task: Task }) {
  const waiting = task.kind === 'overdueAcknowledgement'

  return (
    <HugeiconsIcon
      icon={waiting ? Clock01Icon : Alert02Icon}
      strokeWidth={2}
      aria-hidden
      className={waiting ? 'text-muted-foreground' : 'text-destructive'}
    />
  )
}
