'use client'

import { useTranslations } from 'next-intl'

type LinkNames = { source: string; target: string }

export function useRemoveText() {
  const t = useTranslations('Mapping')

  return {
    linkLabel: (proposed: boolean, names: LinkNames) =>
      proposed ? t('aiReview.rejectLinkLabel', names) : t('links.removeLabel', names),
    link: (proposed: boolean) => (proposed ? t('aiReview.reject') : t('links.remove')),
    transformLabel: (proposed: boolean, name: string) =>
      proposed
        ? t('aiReview.rejectTransformLabel', { name })
        : t('transforms.node.remove', { name }),
    transform: (proposed: boolean, name: string) =>
      proposed
        ? t('aiReview.rejectTransform', { name })
        : t('transforms.details.removeLabel', { name }),
  }
}
