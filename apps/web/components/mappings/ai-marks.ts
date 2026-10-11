import { createContext, useContext } from 'react'

import { type AiReview, linkEndKey, transformLinkKey } from '@edi-bridge/contracts'

import type { RowLink } from '@/components/mappings/mapping-links'
import type { LinkEnd, MappingLink, TransformLink } from '@edi-bridge/contracts'

export type AiMarks = {
  open: boolean
  link: (link: Pick<MappingLink, 'targetPath'>) => boolean
  transform: (transformId: string) => boolean
  transformLink: (link: TransformLink) => boolean
  end: (end: LinkEnd) => boolean
}

export function aiMarks(review: AiReview | null | undefined): AiMarks {
  const links = new Set(review?.proposedLinks)
  const transforms = new Set(review?.proposedTransforms)
  const transformLinks = new Set(review?.proposedTransformLinks)

  return {
    open: Boolean(review),
    link: ({ targetPath }) => links.has(targetPath),
    transform: (transformId) => transforms.has(transformId),
    transformLink: (link) => transformLinks.has(transformLinkKey(link)),
    end: (end) =>
      transformLinks.has(linkEndKey(end)) || (end.kind === 'target' && links.has(end.path)),
  }
}

export function rowLinkProposed(marks: AiMarks, link: RowLink) {
  return link.kind === 'link' ? marks.link(link.link) : marks.transformLink(link.link)
}

export function proposedLinkCount(
  marks: AiMarks,
  links: ReadonlyArray<Pick<MappingLink, 'targetPath'>>,
) {
  return links.filter((link) => marks.link(link)).length
}

export function aiProposedCount(review: AiReview | null | undefined) {
  return review
    ? review.proposedLinks.length +
        review.proposedTransforms.length +
        review.proposedTransformLinks.length
    : 0
}

export const AiMarksContext = createContext<AiMarks>(aiMarks(null))

export function useAiMarks() {
  return useContext(AiMarksContext)
}
