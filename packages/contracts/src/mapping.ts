import { z } from 'zod'

import { aiReviewProblems, aiReviewSchema } from './ai-review'
import { directionSchema, messageTypeSchema } from './message-type'
import { tradingPartnerSummarySchema } from './trading-partner'
import {
  type MappingTransform,
  mappingTransformSchema,
  type TransformLink,
  transformLinkSchema,
  transformLinkTargets,
  transformPorts,
} from './transform'

import type { Endpoint } from './endpoint'

export const mappingSummarySchema = z
  .object({
    id: z.uuid(),
    name: z.string().min(1),
    direction: directionSchema,
    messageType: messageTypeSchema,
    documentStructureId: z.uuid(),
    documentStructureName: z.string().min(1),
    latestVersion: z.number().int().min(1).nullable(),
    latestVersionPublishedAt: z.iso.datetime().nullable(),
    unpublishedChanges: z.boolean(),
    draftUpdatedAt: z.iso.datetime(),
    partners: z.array(tradingPartnerSummarySchema),
    documentsLast7Days: z.number().int().min(0),
    failedRunsLast7Days: z.number().int().min(0),
  })
  .refine(
    ({ latestVersion, latestVersionPublishedAt }) =>
      (latestVersion === null) === (latestVersionPublishedAt === null),
    { message: 'A Mapping has a publication date exactly when it has a latest version' },
  )
  .refine(({ latestVersion, unpublishedChanges }) => latestVersion !== null || unpublishedChanges, {
    message: 'A Mapping that was never published has unpublished changes',
  })
  .refine(
    ({ documentsLast7Days, failedRunsLast7Days }) => failedRunsLast7Days <= documentsLast7Days,
    { message: 'A Mapping has no more failed Runs than Documents' },
  )
  .refine(({ partners }) => new Set(partners.map(({ id }) => id)).size === partners.length, {
    message: 'A Mapping lists each Trading Partner once',
  })

export type MappingSummary = z.infer<typeof mappingSummarySchema>

export const documentStructureSideSchema = z.object({
  kind: z.literal('documentStructure'),
  documentStructureId: z.uuid(),
  name: z.string().min(1),
})

export type DocumentStructureSide = z.infer<typeof documentStructureSideSchema>

export const messageTypeSideSchema = z.object({
  kind: z.literal('messageType'),
  messageType: messageTypeSchema,
})

export type MessageTypeSide = z.infer<typeof messageTypeSideSchema>

export const mappingSideSchema = z.discriminatedUnion('kind', [
  documentStructureSideSchema,
  messageTypeSideSchema,
])

export type MappingSide = z.infer<typeof mappingSideSchema>

// A link copies the value at a source path into a target path, e.g. `buyer.gln` into
// `SG2+BY/NAD+BY/C082/3039`. Combining several sources into one target needs a transform.
export const mappingLinkSchema = z.object({
  sourcePath: z.string().min(1),
  targetPath: z.string().min(1),
})

export type MappingLink = z.infer<typeof mappingLinkSchema>

export type GraphParts = {
  links: ReadonlyArray<MappingLink>
  transforms: ReadonlyArray<MappingTransform>
  transformLinks: ReadonlyArray<TransformLink>
}

function feedsInCircle({ transforms, transformLinks }: GraphParts) {
  const next = new Map(transforms.map(({ id }) => [id, new Set<string>()]))

  for (const { from, to } of transformLinks) {
    if (from.kind === 'transform' && to.kind === 'transform') {
      next.get(from.transformId)?.add(to.transformId)
    }
  }

  const done = new Set<string>()
  const visiting = new Set<string>()

  const visit = (id: string): boolean => {
    if (visiting.has(id)) {
      return true
    }

    if (done.has(id)) {
      return false
    }

    visiting.add(id)
    const circle = [...(next.get(id) ?? [])].some(visit)
    visiting.delete(id)
    done.add(id)

    return circle
  }

  return transforms.some(({ id }) => visit(id))
}

function graphProblems(graph: GraphParts): string[] {
  const problems: string[] = []

  const ports = new Map(
    graph.transforms.map((transform) => [transform.id, transformPorts(transform)]),
  )

  if (ports.size !== graph.transforms.length) {
    problems.push('Every transform has its own id')
  }

  const targets = [
    ...graph.links.map(({ targetPath }) => targetPath),
    ...transformLinkTargets(graph.transformLinks),
  ]

  if (new Set(targets).size !== targets.length) {
    problems.push('A target is linked at most once')
  }

  const inputs = graph.transformLinks.flatMap(({ to }) =>
    to.kind === 'transform' ? [`${to.transformId}/${to.input}`] : [],
  )

  if (new Set(inputs).size !== inputs.length) {
    problems.push('A transform input is linked at most once')
  }

  for (const { from, to } of graph.transformLinks) {
    if (from.kind === 'transform' && !ports.get(from.transformId)?.outputs.includes(from.output)) {
      problems.push(`No transform ${from.transformId} with the output ${from.output}`)
    }

    if (to.kind === 'transform' && !ports.get(to.transformId)?.inputs.includes(to.input)) {
      problems.push(`No transform ${to.transformId} with the input ${to.input}`)
    }
  }

  if (feedsInCircle(graph)) {
    problems.push('Transforms do not feed each other in a circle')
  }

  return problems
}

// Links and transforms form one graph and are saved together, since links end at transform inputs.
export const graphFields = {
  links: z.array(mappingLinkSchema),
  transforms: z.array(mappingTransformSchema),
  transformLinks: z.array(transformLinkSchema),
}

export function checkGraph(graph: GraphParts, context: z.RefinementCtx) {
  for (const message of graphProblems(graph)) {
    context.addIssue({ code: 'custom', message })
  }
}

export const mappingGraphSchema = z.object(graphFields).superRefine(checkGraph)

export type MappingGraph = z.infer<typeof mappingGraphSchema>

// Outbound Mappings turn the own systems' Document into EDIFACT, inbound ones the other way.
export const outboundSides = {
  direction: z.literal('outbound'),
  source: documentStructureSideSchema,
  target: messageTypeSideSchema,
}

export const inboundSides = {
  direction: z.literal('inbound'),
  source: messageTypeSideSchema,
  target: documentStructureSideSchema,
}

const draftFields = {
  mappingId: z.uuid(),
  name: z.string().min(1),
  updatedAt: z.iso.datetime(),
  latestVersion: z.number().int().min(1).nullable(),
  unpublishedChanges: z.boolean(),
  aiReview: aiReviewSchema.nullable().default(null),
}

export const mappingDraftSchema = z
  .discriminatedUnion('direction', [
    z.object({ ...draftFields, ...graphFields, ...outboundSides }),
    z.object({ ...draftFields, ...graphFields, ...inboundSides }),
  ])
  .superRefine(checkGraph)
  .refine(({ latestVersion, unpublishedChanges }) => latestVersion !== null || unpublishedChanges, {
    message: 'A Draft that was never published has unpublished changes',
  })
  .superRefine((draft, context) => {
    for (const message of draft.aiReview ? aiReviewProblems(draft.aiReview, draft) : []) {
      context.addIssue({ code: 'custom', path: ['aiReview'], message })
    }
  })

export type MappingDraft = z.infer<typeof mappingDraftSchema>

export const saveMappingDraftBodySchema = mappingGraphSchema

export type SaveMappingDraftBody = MappingGraph

export const mappingsEndpoint: Endpoint<MappingSummary[]> = {
  method: 'GET',
  path: '/mappings',
  response: z.array(mappingSummarySchema),
}

export const newMappingMessageTypes = ['ORDERS', 'DESADV', 'INVOIC'] as const

export const createMappingBodySchema = z.strictObject({
  messageType: messageTypeSchema.extract(newMappingMessageTypes),
})

export type CreateMappingBody = z.infer<typeof createMappingBodySchema>

export const createMappingEndpoint: Endpoint<
  MappingSummary,
  undefined,
  CreateMappingBody,
  '/mappings'
> = {
  method: 'POST',
  path: '/mappings',
  body: createMappingBodySchema,
  response: mappingSummarySchema,
}

export const mappingDraftEndpoint: Endpoint<
  MappingDraft,
  undefined,
  undefined,
  '/mappings/:id/draft'
> = {
  method: 'GET',
  path: '/mappings/:id/draft',
  response: mappingDraftSchema,
}

export const saveMappingDraftEndpoint: Endpoint<
  MappingDraft,
  undefined,
  SaveMappingDraftBody,
  '/mappings/:id/draft'
> = {
  method: 'PUT',
  path: '/mappings/:id/draft',
  body: saveMappingDraftBodySchema,
  response: mappingDraftSchema,
}
