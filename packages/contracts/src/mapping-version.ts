import { z } from 'zod'

import {
  checkGraph,
  type GraphParts,
  graphFields,
  inboundSides,
  type MappingDraft,
  mappingDraftSchema,
  mappingLinkSchema,
  outboundSides,
} from './mapping'
import { documentContentSchema, previewNoteSchema } from './mapping-preview'
import { messageTypeSchema } from './message-type'
import {
  type LinkEnd,
  type LinkStart,
  type MappingTransform,
  mappingTransformSchema,
  type TransformLink,
  transformLinkSchema,
} from './transform'

import type { Endpoint } from './endpoint'

export const mappingVersionSummarySchema = z.object({
  id: z.uuid(),
  mappingId: z.uuid(),
  mappingName: z.string().min(1),
  version: z.number().int().min(1),
  publishedAt: z.iso.datetime(),
})

export type MappingVersionSummary = z.infer<typeof mappingVersionSummarySchema>

const nameCollator = new Intl.Collator('de')

export function byNameAndNewest(a: MappingVersionSummary, b: MappingVersionSummary) {
  return nameCollator.compare(a.mappingName, b.mappingName) || b.version - a.version
}

export const publishedMappingVersionsQuerySchema = z.object({
  messageType: messageTypeSchema.optional(),
})

export type PublishedMappingVersionsQuery = z.infer<typeof publishedMappingVersionsQuerySchema>

export const publishedMappingVersionsEndpoint: Endpoint<
  MappingVersionSummary[],
  PublishedMappingVersionsQuery
> = {
  method: 'GET',
  path: '/mapping-versions',
  query: publishedMappingVersionsQuerySchema,
  response: z.array(mappingVersionSummarySchema),
}

const summaryFields = mappingVersionSummarySchema.shape

export const mappingVersionSchema = z
  .discriminatedUnion('direction', [
    z.object({ ...summaryFields, ...graphFields, ...outboundSides }),
    z.object({ ...summaryFields, ...graphFields, ...inboundSides }),
  ])
  .superRefine(checkGraph)

export type MappingVersion = z.infer<typeof mappingVersionSchema>

export const mappingVersionEndpoint: Endpoint<
  MappingVersion,
  undefined,
  undefined,
  '/mappings/:mappingId/versions/:versionId'
> = {
  method: 'GET',
  path: '/mappings/:mappingId/versions/:versionId',
  response: mappingVersionSchema,
}

export const restoreMappingVersionEndpoint: Endpoint<
  MappingDraft,
  undefined,
  undefined,
  '/mappings/:mappingId/versions/:versionId/restore'
> = {
  method: 'POST',
  path: '/mappings/:mappingId/versions/:versionId/restore',
  response: mappingDraftSchema,
}

export const differenceChanges = ['added', 'removed', 'changed'] as const

export type DifferenceChange = (typeof differenceChanges)[number]

function differenceOf<Kind extends string, Part extends z.ZodType>(kind: Kind, part: Part) {
  return z.object({
    kind: z.literal(kind),
    change: z.enum(differenceChanges),
    before: part.nullable(),
    after: part.nullable(),
  })
}

const presentSides = {
  added: { before: false, after: true },
  removed: { before: true, after: false },
  changed: { before: true, after: true },
} as const satisfies Record<DifferenceChange, { before: boolean; after: boolean }>

// Links are matched by their target, transforms by their id; a moved transform is no difference.
export const mappingDifferenceSchema = z
  .discriminatedUnion('kind', [
    differenceOf('link', mappingLinkSchema),
    differenceOf('transform', mappingTransformSchema),
    differenceOf('transformLink', transformLinkSchema),
  ])
  .refine(
    ({ change, before, after }) =>
      (before !== null) === presentSides[change].before &&
      (after !== null) === presentSides[change].after,
    { message: 'Only a removed part lacks an after, only an added part lacks a before' },
  )
  .refine(({ kind, change }) => kind !== 'transformLink' || change !== 'changed', {
    message: 'A transform link is added or removed, never changed',
  })

export type MappingDifference = z.infer<typeof mappingDifferenceSchema>

type Change<Part> = Pick<MappingDifference, 'change'> & { before: Part | null; after: Part | null }

function changes<Part>(
  before: ReadonlyArray<Part>,
  after: ReadonlyArray<Part>,
  keyOf: (part: Part) => string,
  same: (a: Part, b: Part) => boolean,
): Change<Part>[] {
  const earlier = new Map(before.map((part) => [keyOf(part), part]))
  const later = new Map(after.map((part) => [keyOf(part), part]))

  return [
    ...[...earlier].flatMap(([key, part]): Change<Part>[] => {
      const next = later.get(key)

      if (next === undefined) {
        return [{ change: 'removed', before: part, after: null }]
      }

      return same(part, next) ? [] : [{ change: 'changed', before: part, after: next }]
    }),
    ...[...later].flatMap(([key, part]): Change<Part>[] =>
      earlier.has(key) ? [] : [{ change: 'added', before: null, after: part }],
    ),
  ]
}

function configKey(transform: MappingTransform) {
  return `${transform.kind}:${JSON.stringify(transform.config, Object.keys(transform.config).sort())}`
}

function endKey(end: LinkStart | LinkEnd) {
  switch (end.kind) {
    case 'source':
    case 'target':
      return `${end.kind}:${end.path}`
    case 'transform':
      return `transform:${end.transformId}/${'output' in end ? end.output : end.input}`
  }
}

const transformLinkKey = ({ from, to }: TransformLink) => `${endKey(from)}>${endKey(to)}`

export function mappingDifferences(before: GraphParts, after: GraphParts): MappingDifference[] {
  return [
    ...changes(
      before.links,
      after.links,
      ({ targetPath }) => targetPath,
      (a, b) => a.sourcePath === b.sourcePath,
    ).map((change): MappingDifference => ({ kind: 'link', ...change })),
    ...changes(
      before.transforms,
      after.transforms,
      ({ id }) => id,
      (a, b) => configKey(a) === configKey(b),
    ).map((change): MappingDifference => ({ kind: 'transform', ...change })),
    ...changes(before.transformLinks, after.transformLinks, transformLinkKey, () => true).map(
      (change): MappingDifference => ({ kind: 'transformLink', ...change }),
    ),
  ]
}

export const outputDifferenceSchema = z
  .object({
    path: z.string().min(1),
    repetitions: z.array(z.number().int().min(0)),
    before: z.string().nullable(),
    after: z.string().nullable(),
  })
  .refine(({ before, after }) => before !== after, {
    message: 'An output difference changes the value',
  })

export type OutputDifference = z.infer<typeof outputDifferenceSchema>

export const versionOutputSchema = z.object({
  document: documentContentSchema,
  notes: z.array(previewNoteSchema),
})

export type VersionOutput = z.infer<typeof versionOutputSchema>

export const comparisonOutputsSchema = z.object({
  sampleId: z.uuid(),
  from: versionOutputSchema,
  to: versionOutputSchema,
  differences: z.array(outputDifferenceSchema),
})

export type ComparisonOutputs = z.infer<typeof comparisonOutputsSchema>

export const mappingComparisonSchema = z
  .object({
    mappingId: z.uuid(),
    from: mappingVersionSummarySchema,
    to: mappingVersionSummarySchema,
    differences: z.array(mappingDifferenceSchema),
    outputs: comparisonOutputsSchema.nullable(),
  })
  .refine(({ mappingId, from, to }) => from.mappingId === mappingId && to.mappingId === mappingId, {
    message: 'Both versions belong to the compared Mapping',
  })
  .refine(({ from, to }) => from.id !== to.id, { message: 'Two different versions are compared' })

export type MappingComparison = z.infer<typeof mappingComparisonSchema>

export const mappingComparisonQuerySchema = z
  .object({
    from: z.uuid(),
    to: z.uuid(),
    sampleId: z.uuid().optional(),
  })
  .refine(({ from, to }) => from !== to, { message: 'Two different versions are compared' })

export type MappingComparisonQuery = z.infer<typeof mappingComparisonQuerySchema>

export const mappingComparisonEndpoint: Endpoint<
  MappingComparison,
  MappingComparisonQuery,
  undefined,
  '/mappings/:mappingId/comparison'
> = {
  method: 'GET',
  path: '/mappings/:mappingId/comparison',
  query: mappingComparisonQuerySchema,
  response: mappingComparisonSchema,
}
