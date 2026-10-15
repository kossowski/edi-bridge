import { delay, http, HttpResponse } from 'msw'

import {
  type DocumentStructure,
  fromSearchParams,
  type GraphParts,
  type LinkEnd,
  type LinkStart,
  type MappingComparison,
  mappingComparisonEndpoint,
  type MappingDifference,
  type MappingGraph,
  type MappingLink,
  mappingSideLeaves,
  type MappingTransform,
  type MappingVersion,
  mappingVersionEndpoint,
  type MappingVersionEntry,
  mappingVersionEntrySchema,
  mappingVersionSchema,
  mappingVersionsEndpoint,
  type MappingVersionSummary,
  type MessageType,
  oriented,
  type OutputDifference,
  type PinnedFlow,
  publishedMappingVersionsEndpoint,
  publishMappingDraftEndpoint,
  restoreMappingVersionEndpoint,
  type Session,
  type TradingPartner,
  type TransformLink,
  transformIssues,
} from '@edi-bridge/contracts'

import {
  type DocumentStructureStore,
  seedDocumentStructures,
  toDocumentStructureStore,
} from './document-structure'
import {
  byNameAndNewest,
  type FlowRecord,
  type FlowStore,
  type MappingCatalogue,
  type MappingRecord,
  seedFlows,
  toFlowStore,
  toMappingCatalogue,
} from './flow'
import { hash } from './hash'
import {
  type LookupTableRecord,
  type LookupTableStore,
  seedLookupTables,
  toLookupTableStore,
} from './lookup-table'
import {
  linkProblem,
  type MappingDraftRecord,
  type MappingDraftStore,
  publishedVersionsOf,
  seedMappingDrafts,
  structureOf,
  toMappingDraft,
  toMappingDraftStore,
} from './mapping'
import { lookUpIn, previewOutput } from './mapping-preview'
import { type MappingSampleRecord, seedMappingSamples } from './mapping-sample'
import {
  aiReviewOpen,
  badRequest,
  conflict,
  notFound,
  serverError,
  unauthorized,
  unprocessable,
} from './responses'
import { seedSession } from './session'
import { type SessionStore, sessionStoreOf } from './session-access'
import {
  seedTradingPartners,
  type TradingPartnerStore,
  toTradingPartnerStore,
} from './trading-partner'
import { seedWorkspaceMembers } from './workspace-member'

import type { Entry } from './document-values'

function toGraph({ links, transforms, transformLinks }: GraphParts): MappingGraph {
  return { links: [...links], transforms: [...transforms], transformLinks: [...transformLinks] }
}

type VersionHistory = Pick<MappingVersionEntry, 'changeNote' | 'publishedBy'>

export type MappingVersionRecord = MappingVersionSummary &
  GraphParts &
  VersionHistory & {
    messageType: MessageType
    documentStructureId: string
  }

const seedPublishers: ReadonlyArray<VersionHistory['publishedBy']> = [
  ...seedWorkspaceMembers.values(),
]
  .flat()
  .filter(({ role }) => role === 'admin')
  .map(({ id, name }) => ({ id, name }))

const seedChangeNotes = [
  'Despatch number taken from the ERP delivery note',
  'Unit codes translated with the code translation',
  'Delivery date added to the header',
  'GTIN read from the article master instead of the order line',
  'Buyer and supplier GLNs swapped back',
  'Free text shortened to 70 characters',
  'Prices rounded to two decimal places',
  'Package count added per line',
] as const

// Versions from before change notes existed carry none.
const changeNotesSince = Date.parse('2026-04-01T00:00:00.000Z')

function seedHistory({ id, publishedAt }: MappingVersionSummary): VersionHistory {
  return {
    changeNote:
      Date.parse(publishedAt) < changeNotesSince
        ? null
        : seedChangeNotes[hash(`change-note:${id}`) % seedChangeNotes.length]!,
    publishedBy: seedPublishers[hash(`published-by:${id}`) % seedPublishers.length]!,
  }
}

type DocumentStructures = ReadonlyArray<DocumentStructure>

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

// Comparing seed versions should show every kind of change.
function stepsBack(graph: GraphParts, steps: number): GraphParts {
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

export function deriveMappingVersions(draft: MappingDraftRecord): MappingVersionRecord[] {
  const summaries = publishedVersionsOf(draft)
  const latest = summaries[0]?.version ?? 0
  const unpublished = draft.unpublishedChanges ? 1 : 0

  return summaries.map((summary) => ({
    ...summary,
    ...seedHistory(summary),
    messageType: draft.messageType,
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

// The store is also the catalogue the Flows pin from, so a published version is offered there.
export type MappingVersionStore = MappingCatalogue & {
  all: () => readonly MappingVersionRecord[]
  of: (mappingId: string) => MappingVersionRecord[]
  get: (versionId: string) => MappingVersionRecord | undefined
  add: (version: MappingVersionRecord) => void
}

export function createMappingVersionStore(
  versions: ReadonlyArray<MappingVersionRecord> = seedMappingVersions,
): MappingVersionStore {
  const byId = new Map(versions.map((version) => [version.id, version]))

  const of = (mappingId: string) =>
    [...byId.values()]
      .filter((version) => version.mappingId === mappingId)
      .sort((a, b) => b.version - a.version)

  const mappingOf = ({ mappingId, messageType }: MappingVersionRecord): MappingRecord => ({
    mappingId,
    messageType,
    versions: of(mappingId).map(toMappingVersionSummary),
  })

  return {
    all: () => [...byId.values()],
    of,
    get: (versionId) => byId.get(versionId),
    add: (version) => {
      byId.set(version.id, version)
    },
    published: (messageType) =>
      [...byId.values()]
        .flatMap((version) =>
          messageType === undefined || version.messageType === messageType
            ? [toMappingVersionSummary(version)]
            : [],
        )
        .sort(byNameAndNewest),
    find: (versionId) => {
      const version = byId.get(versionId)

      return version && { mapping: mappingOf(version), version: toMappingVersionSummary(version) }
    },
  }
}

export function toMappingVersionStore(
  versions: ReadonlyArray<MappingVersionRecord> | MappingVersionStore,
) {
  return 'of' in versions ? versions : createMappingVersionStore(versions)
}

export function toMappingVersionSummary({
  id,
  mappingId,
  mappingName,
  version,
  publishedAt,
}: MappingVersionSummary): MappingVersionSummary {
  return { id, mappingId, mappingName, version, publishedAt }
}

function pinnedFlows(
  flows: ReadonlyArray<FlowRecord> | FlowStore,
  tradingPartners: ReadonlyArray<TradingPartner> | TradingPartnerStore,
) {
  const flowStore = toFlowStore(flows)
  const tradingPartnerStore = toTradingPartnerStore(tradingPartners)
  const byVersion = new Map<string, PinnedFlow[]>()

  for (const flow of flowStore.all()) {
    const tradingPartner = tradingPartnerStore.get(flow.tradingPartnerId)

    if (tradingPartner) {
      const pinned = byVersion.get(flow.mappingVersionId) ?? []
      pinned.push({
        id: flow.id,
        name: flow.name,
        tradingPartner: { id: tradingPartner.id, name: tradingPartner.name },
      })
      byVersion.set(flow.mappingVersionId, pinned)
    }
  }

  for (const pinned of byVersion.values()) {
    pinned.sort(
      (a, b) =>
        a.tradingPartner.name.localeCompare(b.tradingPartner.name, 'de') ||
        a.name.localeCompare(b.name, 'de'),
    )
  }

  return (versionId: string) => byVersion.get(versionId) ?? []
}

export function mappingVersionEntries(
  flows: ReadonlyArray<FlowRecord> | FlowStore = seedFlows,
  tradingPartners: ReadonlyArray<TradingPartner> | TradingPartnerStore = seedTradingPartners,
) {
  const flowsOf = pinnedFlows(flows, tradingPartners)

  return (version: MappingVersionSummary | MappingVersionRecord): MappingVersionEntry => {
    const { changeNote, publishedBy } = 'publishedBy' in version ? version : seedHistory(version)

    return mappingVersionEntrySchema.parse({
      ...toMappingVersionSummary(version),
      changeNote,
      publishedBy,
      flows: flowsOf(version.id),
    })
  }
}

export function toMappingVersion(
  record: MappingVersionRecord,
  draft: MappingDraftRecord,
  documentStructures: DocumentStructures,
): MappingVersion {
  return mappingVersionSchema.parse({
    ...toMappingVersionSummary(record),
    ...toGraph(record),
    ...oriented(draft.messageType, {
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

export type MappingVersionsState = 'loading' | 'error'

function mappingVersionStateHandlers(apiUrl: string, state: MappingVersionsState) {
  const respond = async () => {
    if (state === 'loading') {
      await delay('infinite')
    }

    return serverError()
  }

  return [
    http.get(`${apiUrl}${mappingVersionsEndpoint.path}`, respond),
    http.post(`${apiUrl}${publishMappingDraftEndpoint.path}`, respond),
    http.post(`${apiUrl}${restoreMappingVersionEndpoint.path}`, respond),
  ]
}

export function mappingVersionHandlers(
  apiUrl: string,
  {
    mappings = seedMappingDrafts,
    versions,
    samples = seedMappingSamples,
    documentStructures = seedDocumentStructures,
    lookupTables = seedLookupTables,
    flows = seedFlows,
    tradingPartners = seedTradingPartners,
    session = seedSession,
  }: {
    mappings?: ReadonlyArray<MappingDraftRecord> | MappingDraftStore
    versions?: ReadonlyArray<MappingVersionRecord> | MappingVersionStore | MappingVersionsState
    flows?: ReadonlyArray<FlowRecord> | FlowStore
    tradingPartners?: ReadonlyArray<TradingPartner> | TradingPartnerStore
    session?: Session | null | SessionStore
    samples?: ReadonlyArray<MappingSampleRecord>
    documentStructures?: DocumentStructures | DocumentStructureStore
    lookupTables?: ReadonlyArray<LookupTableRecord> | LookupTableStore
  } = {},
) {
  if (versions === 'loading' || versions === 'error') {
    return mappingVersionStateHandlers(apiUrl, versions)
  }

  const store = toMappingDraftStore(mappings)
  const structures = toDocumentStructureStore(documentStructures)
  const lookUp = lookUpIn(toLookupTableStore(lookupTables))
  const flowStore = toFlowStore(flows)
  const tradingPartnerStore = toTradingPartnerStore(tradingPartners)

  const sessionStore = sessionStoreOf(session)

  const versionStore = toMappingVersionStore(versions ?? createMappingVersions(store.all()))

  const versionOf = (mappingId: string, versionId: string) => {
    const version = versionStore.get(versionId)

    return version?.mappingId === mappingId ? version : undefined
  }

  return [
    http.get<{ mappingId: string }>(
      `${apiUrl}${mappingVersionsEndpoint.path}`,
      async ({ params }) => {
        await delay()

        if (!store.get(params.mappingId)) {
          return notFound()
        }

        return HttpResponse.json(
          versionStore
            .of(params.mappingId)
            .map(mappingVersionEntries(flowStore, tradingPartnerStore)),
        )
      },
    ),
    http.get<{ mappingId: string; versionId: string }>(
      `${apiUrl}${mappingVersionEndpoint.path}`,
      async ({ params }) => {
        const draft = store.get(params.mappingId)
        const version = versionOf(params.mappingId, params.versionId)

        await delay()

        return draft && version
          ? HttpResponse.json(toMappingVersion(version, draft, structures.all()))
          : notFound()
      },
    ),
    http.post<{ mappingId: string }>(
      `${apiUrl}${publishMappingDraftEndpoint.path}`,
      async ({ params, request }) => {
        const draft = store.get(params.mappingId)

        const body = publishMappingDraftEndpoint.body.safeParse(
          await request.json().catch(() => null),
        )

        await delay()

        if (!draft) {
          return notFound()
        }

        if (!body.success) {
          return badRequest(body.error.message)
        }

        const publisher = sessionStore.get()?.user

        if (!publisher) {
          return unauthorized()
        }

        if (draft.aiReview) {
          return aiReviewOpen()
        }

        if (!draft.unpublishedChanges) {
          return conflict('The Draft has no changes since its latest version.')
        }

        const invalidLink = linkProblem(
          toGraph(draft),
          mappingSideLeaves(draft.messageType, structureOf(draft, structures.all())),
        )

        if (invalidLink) {
          return invalidLink
        }

        if (Object.values(transformIssues(draft)).some((issues) => issues.length > 0)) {
          return unprocessable('Every transform is configured and connected before publishing.')
        }

        const moving = body.data.moveFlowIds.map((id) => flowStore.get(id))

        if (
          moving.some(
            (flow) => !flow || versionStore.get(flow.mappingVersionId)?.mappingId !== draft.id,
          )
        ) {
          return unprocessable('Only Flows that use this Mapping move to the new version.')
        }

        const record: MappingVersionRecord = {
          id: crypto.randomUUID(),
          mappingId: draft.id,
          mappingName: draft.name,
          version: (draft.latestVersion ?? 0) + 1,
          publishedAt: new Date().toISOString(),
          messageType: draft.messageType,
          documentStructureId: draft.documentStructureId,
          changeNote: body.data.changeNote === '' ? null : body.data.changeNote,
          publishedBy: { id: publisher.id, name: publisher.name },
          ...toGraph(draft),
        }

        versionStore.add(record)
        store.set({ ...draft, latestVersion: record.version, unpublishedChanges: false })

        for (const flow of moving) {
          if (flow) {
            flowStore.set({ ...flow, mappingVersionId: record.id })
          }
        }

        return HttpResponse.json(mappingVersionEntries(flowStore, tradingPartnerStore)(record), {
          status: 201,
        })
      },
    ),
    http.post<{ mappingId: string; versionId: string }>(
      `${apiUrl}${restoreMappingVersionEndpoint.path}`,
      async ({ params }) => {
        const draft = store.get(params.mappingId)
        const version = versionOf(params.mappingId, params.versionId)

        await delay()

        if (!draft || !version) {
          return notFound()
        }

        if (draft.aiReview) {
          return aiReviewOpen()
        }

        const graph = toGraph(version)
        const [latest] = versionStore.of(draft.id)

        const record: MappingDraftRecord = {
          ...draft,
          ...graph,
          unpublishedChanges: !latest || mappingDifferences(latest, graph).length > 0,
          updatedAt: new Date().toISOString(),
        }

        store.set(record)

        return HttpResponse.json(toMappingDraft(record, structures.all()))
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
            documentStructures: structures.all(),
            lookUp,
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

export function publishedMappingVersionsHandler(
  apiUrl: string,
  mappings: ReadonlyArray<MappingRecord> | MappingCatalogue,
) {
  const catalogue = toMappingCatalogue(mappings)

  return http.get(`${apiUrl}${publishedMappingVersionsEndpoint.path}`, ({ request }) => {
    const query = publishedMappingVersionsEndpoint.query.safeParse(
      fromSearchParams(new URL(request.url).searchParams),
    )

    return query.success
      ? HttpResponse.json(catalogue.published(query.data.messageType))
      : badRequest(query.error.message)
  })
}
