import { acceptedAiReview, markedAiReviewParts, transformLinkKey } from '@edi-bridge/contracts'

import type { Graph } from '@/components/mappings/mapping-graph'
import type { RowLink } from '@/components/mappings/mapping-links'
import type { AiReview, AiReviewParts, TransformLink } from '@edi-bridge/contracts'

function transformIdsOf({ from, to }: TransformLink) {
  return [
    ...(from.kind === 'transform' ? [from.transformId] : []),
    ...(to.kind === 'transform' ? [to.transformId] : []),
  ]
}

// A Transform Link belongs to the chain of every Transform it reaches through other Transform
// Links, so accepting one accepts the chain as a whole.
function chainOf(graph: Graph, start: TransformLink) {
  const ids = new Set(transformIdsOf(start))
  let grown = true

  while (grown) {
    grown = false

    for (const link of graph.transformLinks) {
      const ends = transformIdsOf(link)

      if (ends.some((id) => ids.has(id)) && ends.some((id) => !ids.has(id))) {
        ends.forEach((id) => ids.add(id))
        grown = true
      }
    }
  }

  return {
    transforms: graph.transforms.flatMap(({ id }) => (ids.has(id) ? [id] : [])),
    transformLinks: graph.transformLinks.flatMap((link) =>
      transformIdsOf(link).some((id) => ids.has(id)) ? [transformLinkKey(link)] : [],
    ),
  }
}

export function partsAcceptedWith(review: AiReview, graph: Graph, link: RowLink): AiReviewParts {
  const parts =
    link.kind === 'link'
      ? { links: [link.link.targetPath], transforms: [], transformLinks: [] }
      : { links: [], ...chainOf(graph, link.link) }

  return markedAiReviewParts(review, parts)
}

export function reviewAfterAccepting(review: AiReview, graph: Graph, link: RowLink) {
  return acceptedAiReview(review, partsAcceptedWith(review, graph, link))
}
