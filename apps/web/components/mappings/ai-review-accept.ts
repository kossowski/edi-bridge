import { acceptedAiReview, markedAiReviewParts, transformLinkKey } from '@edi-bridge/contracts'

import type { ProposedChain } from '@/components/mappings/ai-review-attention'
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
function chainOf(graph: Graph, transformIds: ReadonlyArray<string>) {
  const ids = new Set(transformIds)
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
      : { links: [], ...chainOf(graph, transformIdsOf(link.link)) }

  return markedAiReviewParts(review, parts)
}

function rowLinkInto(graph: Graph, targetPath: string): RowLink | null {
  const plain = graph.links.find((link) => link.targetPath === targetPath)

  if (plain) {
    return { kind: 'link', link: plain }
  }

  const through = graph.transformLinks.find(
    ({ to }) => to.kind === 'target' && to.path === targetPath,
  )

  return through ? { kind: 'transformLink', link: through } : null
}

export function partsAcceptedAt(review: AiReview, graph: Graph, targetPath: string): AiReviewParts {
  const into = rowLinkInto(graph, targetPath)

  return into
    ? partsAcceptedWith(review, graph, into)
    : { links: [], transforms: [], transformLinks: [] }
}

export function partsAcceptedWithChain(
  review: AiReview,
  graph: Graph,
  { targetPath, transformIds }: ProposedChain,
): AiReviewParts {
  if (targetPath !== null) {
    return partsAcceptedAt(review, graph, targetPath)
  }

  return markedAiReviewParts(review, { links: [], ...chainOf(graph, transformIds) })
}

// A plain link is accepted on its own, a Transform Link with its whole chain.
export function acceptMessages(parts: AiReviewParts) {
  return parts.links.length > 0
    ? ({ accept: 'acceptLink', accepted: 'acceptedLink' } as const)
    : ({ accept: 'acceptChain', accepted: 'acceptedChain' } as const)
}

export function reviewAfterAccepting(review: AiReview, graph: Graph, link: RowLink) {
  return acceptedAiReview(review, partsAcceptedWith(review, graph, link))
}
