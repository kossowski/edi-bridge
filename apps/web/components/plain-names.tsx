'use client'

import { useLocale, useTranslations } from 'next-intl'

import type { StatusGroup } from '@/lib/status-groups'
import type { FailureStage, MessageType, RunStatus } from '@edi-bridge/contracts'

export function usePlainNames() {
  const t = useTranslations('PlainNames')
  const locale = useLocale()

  const messageTypeName = (messageType: MessageType, plural = false) =>
    t(`messageType.${messageType}.${plural ? 'plural' : 'name'}`)

  return {
    runStatus: (status: RunStatus) => t(`runStatus.${status}`),
    statusGroup: (group: StatusGroup) => t(`statusGroup.${group}`),
    failureStageTitle: (stage: FailureStage) => t(`failureStage.${stage}.title`),
    failureStageSummary: (stage: FailureStage) => t(`failureStage.${stage}.summary`),
    messageTypeName,
    messageTypeNameInText: (messageType: MessageType) => {
      const name = messageTypeName(messageType)

      return locale === 'de' ? name : name.toLocaleLowerCase(locale)
    },
  }
}

export function MessageTypeName({
  messageType,
  plural = false,
}: {
  messageType: MessageType
  plural?: boolean
}) {
  const plainNames = usePlainNames()

  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-1.5">
      {plainNames.messageTypeName(messageType, plural)}
      <span className="text-muted-foreground font-mono text-xs">{messageType}</span>
    </span>
  )
}
