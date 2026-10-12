'use client'

import { useTranslations } from 'next-intl'

import type { ErrorPosition } from '@edi-bridge/contracts'

export function PositionText({ position }: { position: ErrorPosition }) {
  const t = useTranslations('Document.technical.position')

  return [
    t('segment', { segment: position.segment, tag: position.tag }),
    position.element !== null && t('element', { element: position.element }),
    position.component !== null && t('component', { component: position.component }),
  ]
    .filter(Boolean)
    .join(', ')
}
