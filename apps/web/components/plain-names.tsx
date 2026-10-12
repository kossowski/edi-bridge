'use client'

import { useTranslations } from 'next-intl'

import type { FailureStage, MessageType } from '@edi-bridge/contracts'

export type WhoFixes = 'you' | 'partner' | 'retry'

export const failureStageWhoFixes: Record<FailureStage, WhoFixes> = {
  parse: 'partner',
  validation: 'partner',
  mapping: 'you',
  delivery: 'retry',
}

export function MessageTypeName({
  messageType,
  plural = false,
}: {
  messageType: MessageType
  plural?: boolean
}) {
  const t = useTranslations('PlainNames.messageType')

  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-1.5">
      {plural ? t(`${messageType}.plural`) : t(`${messageType}.name`)}
      <span className="text-muted-foreground font-mono text-xs">{messageType}</span>
    </span>
  )
}
