import { delay, http, HttpResponse } from 'msw'

import {
  directionOf,
  type DocumentStructure,
  fromSearchParams,
  type LinkEnd,
  type LinkStart,
  type MappingComparison,
  mappingComparisonEndpoint,
  type MappingDifference,
  type MappingGraph,
  type MappingLink,
  type MappingSide,
  type MappingTransform,
  type MappingVersion,
  mappingVersionEndpoint,
  mappingVersionSchema,
  mappingVersionsEndpoint,
  type MappingVersionSummary,
  mappingVersionSummarySchema,
  type OutputDifference,
  publishMappingDraftEndpoint,
  type TransformLink,
  transformIssues,
} from '@edi-bridge/contracts'

import { seedDocumentStructures } from './document-structure'
import { seedMappings } from './flow'
import {
  linkProblem,
  type MappingDraftRecord,
  type MappingDraftStore,
  oriented,
  seedMappingDrafts,
  sideLeaves,
  structureOf,
  toMappingDraftStore,
} from './mapping'
import { previewOutput } from './mapping-preview'
import { type MappingSampleRecord, seedMappingSamples } from './mapping-sample'
import { badRequest, conflict, notFound, unprocessable } from './responses'
import { stableUuid } from './seed-id'

import type { Entry } from './document-values'

type Graph = {
  links: ReadonlyArray<MappingLink>
  transforms: ReadonlyArray<MappingTransform>
  transformLinks: ReadonlyArray<TransformLink>
}

function toGraph({ links, transforms, transformLinks }: Graph): MappingGraph {
  return { links: [...links], transforms: [...transforms], transformLinks: [...transformLinks] }
}

export type MappingVersionRecord = MappingVersionSummary & Graph & { documentStructureId: string }

type DocumentStructures = ReadonlyArray<DocumentStructure>

const versionSpacing = 9 * 86_400_000

// Seed Mappings keep the versions their Flows and Runs already pin.
function versionSummaries(draft: MappingDraftRecord): MappingVersionSummary[] {
  const count = draft.latestVersion ?? 0
  const seeded = seedMappings.find(({ mappingId }) => mappingId === draft.id)?.versions

  if (seeded?.length === count) {
    return [...seeded]
  }

  const newest = Date.parse(draft.updatedAt) - versionSpacing

  return Array.from({ length: count }, (_, index) => {
    const version = count - index

    return mappingVersionSummarySchema.parse({
      id: stableUuid(`${draft.id}:version:${version}`),
      mappingId: draft.id,
      mappingName: draft.name,
      version,
      publishedAt: new Date(newest - index * versionSpacing).toISOString(),
    })
  })
}

function earlierConfig(transform: MappingTransform): MappingTransform {
  switch (transform.kind) {
    case 'substring':
      return { ...transform, config: { ...transform.config, length: 30 } }
    case 'numberFormat':
      return { ...transform, config: { ...transform.config, decimalPlaces: 2 } }
    default:
      return transform
  }
}

function swapFirstSources(links: ReadonlyArray<MappingLink>): MappingLink[] {
  const [first, second, ...rest] = links

  return first && second
    ? [
        { ...first, sourcePath: second.sourcePath },
        { ...second, sourcePath: first.sourcePath },
        ...rest,
      ]
    : [...links]
}

// Each step back drops the two newest links and the newest transform, and some configurations and
// sources differ, so comparing versions shows every kind of change.
function stepsBack(graph: Graph, steps: number): Graph {
  if (steps === 0) {
    return toGraph(graph)
  }

  const transforms = graph.transforms
    .slice(0, Math.max(graph.transforms.length - steps, 0))
    .map(earlierConfig)

  const kept = new Set(transforms.map(({ id }) => id))

  return {
    links: swapFirstSources(graph.links.slice(0, Math.max(graph.links.length - 2 * steps, 0))),
    transforms,
    transformLinks: graph.transformLinks.filter(
      ({ from, to }) =>
        (from.kind !== 'transform' || kept.has(from.transformId)) &&
        (to.kind !== 'transform' || kept.has(to.transformId)),
    ),
  }
}

// Versions are derived from the Draft: the latest one equals it unless the Draft has unpublished
// changes, and each older one goes a step further back.
export function deriveMappingVersions(draft: MappingDraftRecord): MappingVersionRecord[] {
  const summaries = versionSummaries(draft)
  const latest = summaries[0]?.version ?? 0
  const unpublished = draft.unpublishedChanges ? 1 : 0

  return summaries.map((summary) => ({
    ...summary,
    documentStructureId: draft.documentStructureId,
    ...stepsBack(draft, latest - summary.version + unpublished),
  }))
}

export function createMappingVersions(
  drafts: ReadonlyArray<MappingDraftRecord>,
): MappingVersionRecord[] {
  return drafts.flatMap(deriveMappingVersions)
}

export const seedMappingVersions: ReadonlyArray<MappingVersionRecord> =
  createMappingVersions(seedMappingDrafts)

export type MappingVersionStore = {
  of: (mappingId: string) => MappingVersionRecord[]
  get: (versionId: string) => MappingVersionRecord | undefined
  add: (version: MappingVersionRecord) => void
}

export function createMappingVersionStore(
  versions: ReadonlyArray<MappingVersionRecord> = seedMappingVersions,
): MappingVersionStore {
  const byId = new Map(versions.map((version) => [version.id, version]))

  return {
    of: (mappingId) =>
      [...byId.values()]
        .filter((version) => version.mappingId === mappingId)
        .sort((a, b) => b.version - a.version),
    get: (versionId) => byId.get(versionId),
    add: (version) => {
      byId.set(version.id, version)
    },
  }
}

export function toMappingVersionSummary({
  id,
  mappingId,
  mappingName,
  version,
  publishedAt,
}: MappingVersionRecord): MappingVersionSummary {
  return { id, mappingId, mappingName, version, publishedAt }
}

export function toMappingVersion(
  record: MappingVersionRecord,
  draft: MappingDraftRecord,
  documentStructures: DocumentStructures,
): MappingVersion {
  return mappingVersionSchema.parse({
    ...toMappingVersionSummary(record),
    direction: directionOf(draft),
    ...toGraph(record),
    ...oriented<MappingSide>(draft.messageType, {
      document: {
        kind: 'documentStructure',
        documentStructureId: record.documentStructureId,
        name: structureOf(record, documentStructures).name,
      },
      edifact: { kind: 'messageType', messageType: draft.messageType },
    }),
  })
}

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

export function mappingDifferences(before: Graph, after: Graph): MappingDifference[] {
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

export function outputDifferences(
  before: ReadonlyArray<Entry>,
  after: ReadonlyArray<Entry>,
): OutputDifference[] {
  const keyOf = ({ path, at }: Entry) => `${path}|${at.join('/')}`
  const earlier = new Map(before.map((entry) => [keyOf(entry), entry]))
  const later = new Map(after.map((entry) => [keyOf(entry), entry]))

  return [...new Set([...earlier.keys(), ...later.keys()])].flatMap((key) => {
    const from = earlier.get(key)
    const to = later.get(key)
    const { path, at } = (to ?? from)!
    const values = { before: from?.value ?? null, after: to?.value ?? null }

    return values.before === values.after ? [] : [{ path, repetitions: [...at], ...values }]
  })
}

export function mappingVersionHandlers(
  apiUrl: string,
  {
    mappings = seedMappingDrafts,
    versions,
    samples = seedMappingSamples,
    documentStructures = seedDocumentStructures,
  }: {
    mappings?: ReadonlyArray<MappingDraftRecord> | MappingDraftStore
    versions?: ReadonlyArray<MappingVersionRecord> | MappingVersionStore
    samples?: ReadonlyArray<MappingSampleRecord>
    documentStructures?: DocumentStructures
  } = {},
) {
  const store = toMappingDraftStore(mappings)

  const versionStore =
    versions && 'of' in versions
      ? versions
      : createMappingVersionStore(versions ?? createMappingVersions(store.all()))

  const versionOf = (mappingId: string, versionId: string) => {
    const version = versionStore.get(versionId)

    return version?.mappingId === mappingId ? version : undefined
  }

  return [
    http.get<{ mappingId: string }>(`${apiUrl}${mappingVersionsEndpoint.path}`, ({ params }) =>
      store.get(params.mappingId)
        ? HttpResponse.json(versionStore.of(params.mappingId).map(toMappingVersionSummary))
        : notFound(),
    ),
    http.get<{ mappingId: string; versionId: string }>(
      `${apiUrl}${mappingVersionEndpoint.path}`,
      ({ params }) => {
        const draft = store.get(params.mappingId)
        const version = versionOf(params.mappingId, params.versionId)

        return draft && version
          ? HttpResponse.json(toMappingVersion(version, draft, documentStructures))
          : notFound()
      },
    ),
    http.post<{ mappingId: string }>(
      `${apiUrl}${publishMappingDraftEndpoint.path}`,
      ({ params }) => {
        const draft = store.get(params.mappingId)

        if (!draft) {
          return notFound()
        }

        if (!draft.unpublishedChanges) {
          return conflict('The Draft has no changes since its latest version.')
        }

        const invalidLink = linkProblem(toGraph(draft), sideLeaves(draft, documentStructures))

        if (invalidLink) {
          return invalidLink
        }

        if (Object.values(transformIssues(draft)).some((issues) => issues.length > 0)) {
          return unprocessable('Every transform is configured and connected before publishing.')
        }

        const record: MappingVersionRecord = {
          id: crypto.randomUUID(),
          mappingId: draft.id,
          mappingName: draft.name,
          version: (draft.latestVersion ?? 0) + 1,
          publishedAt: new Date().toISOString(),
          documentStructureId: draft.documentStructureId,
          ...toGraph(draft),
        }

        versionStore.add(record)
        store.set({ ...draft, latestVersion: record.version, unpublishedChanges: false })

        return HttpResponse.json(toMappingVersionSummary(record), { status: 201 })
      },
    ),
    http.get<{ mappingId: string }>(
      `${apiUrl}${mappingComparisonEndpoint.path}`,
      async ({ params, request }) => {
        const query = mappingComparisonEndpoint.query.safeParse(
          fromSearchParams(new URL(request.url).searchParams),
        )

        if (!query.success) {
          return badRequest(query.error.message)
        }

        const draft = store.get(params.mappingId)
        const from = versionOf(params.mappingId, query.data.from)
        const to = versionOf(params.mappingId, query.data.to)

        const sample =
          query.data.sampleId === undefined
            ? undefined
            : samples.find(
                ({ id, mappingId }) => id === query.data.sampleId && mappingId === params.mappingId,
              )

        if (!draft || !from || !to || (query.data.sampleId !== undefined && !sample)) {
          return notFound()
        }

        const outputOf = (version: MappingVersionRecord, found: MappingSampleRecord) =>
          previewOutput({
            mapping: { ...draft, documentStructureId: version.documentStructureId },
            graph: toGraph(version),
            sample: found,
            documentStructures,
          })

        const outputs = sample
          ? await Promise.all([outputOf(from, sample), outputOf(to, sample)])
          : undefined

        await delay()

        return HttpResponse.json({
          mappingId: draft.id,
          from: toMappingVersionSummary(from),
          to: toMappingVersionSummary(to),
          differences: mappingDifferences(from, to),
          outputs:
            sample && outputs
              ? {
                  sampleId: sample.id,
                  from: { document: outputs[0].document, notes: outputs[0].notes },
                  to: { document: outputs[1].document, notes: outputs[1].notes },
                  differences: outputDifferences(outputs[0].entries, outputs[1].entries),
                }
              : null,
        } satisfies MappingComparison)
      },
    ),
  ]
}
