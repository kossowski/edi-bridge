import { z } from 'zod'

import type { GraphParts, MappingLink } from './mapping'
import type { LinkEnd, MappingTransform, TransformLink } from './transform'

// Each part a Draft can hold has its own key: a plain link its target path, a transform its id
// and a transform link where it ends, since a target or transform input takes one link at most.
export function linkEndKey(end: LinkEnd) {
  return end.kind === 'target' ? `target:${end.path}` : `input:${end.transformId}/${end.input}`
}

export function transformLinkKey({ to }: TransformLink) {
  return linkEndKey(to)
}

const linkKey = ({ targetPath }: MappingLink) => targetPath

const transformKey = ({ id }: MappingTransform) => id

export function aiReviewKeys(graph: GraphParts) {
  return {
    links: graph.links.map(linkKey),
    transforms: graph.transforms.map(transformKey),
    transformLinks: graph.transformLinks.map(transformLinkKey),
  }
}

// While the review is open, the marks name the AI-proposed parts the Admin has neither rejected
// nor edited; accepting the Draft ends the review and leaves `aiReview` null.
export const aiReviewSchema = z.object({
  sampleId: z.uuid(),
  proposedLinks: z.array(z.string().min(1)),
  proposedTransforms: z.array(z.uuid()),
  proposedTransformLinks: z.array(z.string().min(1)),
})

export type AiReview = z.infer<typeof aiReviewSchema>

export function aiReviewProblems(review: AiReview, graph: GraphParts): string[] {
  const keys = aiReviewKeys(graph)

  const missing = (marked: ReadonlyArray<string>, present: ReadonlyArray<string>) => {
    const has = new Set(present)

    return marked.filter((key) => !has.has(key))
  }

  return [
    ...missing(review.proposedLinks, keys.links),
    ...missing(review.proposedTransforms, keys.transforms),
    ...missing(review.proposedTransformLinks, keys.transformLinks),
  ].map((key) => `The AI review marks ${key}, which the Draft does not have`)
}

const sameTransform = (before: MappingTransform, after: MappingTransform) =>
  before.kind === after.kind && JSON.stringify(before.config) === JSON.stringify(after.config)

const sameStart = (before: TransformLink, after: TransformLink) =>
  JSON.stringify(before.from) === JSON.stringify(after.from)

function keptKeys<Part>(
  keys: ReadonlyArray<string>,
  before: ReadonlyArray<Part>,
  after: ReadonlyArray<Part>,
  keyOf: (part: Part) => string,
  same: (before: Part, after: Part) => boolean,
) {
  const previous = new Map(before.map((part) => [keyOf(part), part]))
  const next = new Map(after.map((part) => [keyOf(part), part]))

  return keys.filter((key) => {
    const was = previous.get(key)
    const is = next.get(key)

    return was !== undefined && is !== undefined && same(was, is)
  })
}

// A rejected part is gone and an edited one differs, so both lose their mark; moving a transform
// on the canvas is no edit.
export function remainingAiReview(review: AiReview, before: GraphParts, after: GraphParts) {
  return {
    ...review,
    proposedLinks: keptKeys(
      review.proposedLinks,
      before.links,
      after.links,
      linkKey,
      (was, is) => was.sourcePath === is.sourcePath,
    ),
    proposedTransforms: keptKeys(
      review.proposedTransforms,
      before.transforms,
      after.transforms,
      transformKey,
      sameTransform,
    ),
    proposedTransformLinks: keptKeys(
      review.proposedTransformLinks,
      before.transformLinks,
      after.transformLinks,
      transformLinkKey,
      sameStart,
    ),
  }
}
