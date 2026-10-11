import { delay, http, HttpResponse } from 'msw'

import {
  acceptAiDraftEndpoint,
  type AiBudget,
  aiBudgetEndpoint,
  aiBudgetExhausted,
  type AiBudgetExhaustedProblem,
  aiBudgetExhaustedStatus,
  type AiDraftEvent,
  type AiDraftStep,
  type AiProposal,
  type AiReview,
  type DocumentStructure,
  type MappingLink,
  requestAiDraftEndpoint,
  type Session,
  type TransformLink,
  transformLinkKey,
  transformLinkTargets,
  type WorkspaceSettings,
} from '@edi-bridge/contracts'

import {
  type DocumentStructureStore,
  seedDocumentStructures,
  toDocumentStructureStore,
} from './document-structure'
import {
  link,
  linkTemplates,
  type MappingDraftRecord,
  type MappingDraftStore,
  sideLeaves,
  templateGraph,
  toMappingDraft,
  toMappingDraftStore,
  type TransformGraph,
  unknownPaths,
  withoutInvalidTransforms,
} from './mapping'
import { type MappingSampleRecord, seedMappingSamples } from './mapping-sample'
import { aiReviewOpen, badRequest, conflict, notFound } from './responses'
import { seededFaker } from './seeded-faker'
import { seedSession, toSessionStore } from './session'
import { adminOnly, type SessionStore } from './session-access'
import {
  seedWorkspaceSettings,
  toWorkspaceSettingsStore,
  type WorkspaceSettingsStore,
} from './workspace-settings'

export type AiDraftState = 'proposing' | 'empty' | 'large' | 'loading' | 'error' | 'budgetExhausted'

export type AiProposalSize = 'regular' | 'large' | 'empty'

export type AiDraftOptions = {
  mappings?: ReadonlyArray<MappingDraftRecord> | MappingDraftStore
  samples?: ReadonlyArray<MappingSampleRecord>
  documentStructures?: ReadonlyArray<DocumentStructure> | DocumentStructureStore
  session?: Session | null | SessionStore
  settings?: WorkspaceSettings | WorkspaceSettingsStore
  state?: AiDraftState
  stepDelayMs?: number
  signal?: AbortSignal
}

export const aiDraftTokens = 18_400

const proposalSizes: Readonly<Record<AiDraftState, AiProposalSize>> = {
  proposing: 'regular',
  empty: 'empty',
  large: 'large',
  loading: 'regular',
  error: 'regular',
  budgetExhausted: 'regular',
}

const encoder = new TextEncoder()

function frameOf(event: AiDraftEvent) {
  return encoder.encode(`data:${JSON.stringify(requestAiDraftEndpoint.event.parse(event))}\n\n`)
}

function nextMidnight(now: Date) {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
  ).toISOString()
}

const touchesAny =
  (ids: ReadonlySet<string>) =>
  ({ from, to }: TransformLink) =>
    (from.kind === 'transform' && ids.has(from.transformId)) ||
    (to.kind === 'transform' && ids.has(to.transformId))

function withoutTransforms(graph: TransformGraph, ids: ReadonlySet<string>): TransformGraph {
  return {
    transforms: graph.transforms.filter(({ id }) => !ids.has(id)),
    transformLinks: graph.transformLinks.filter((transformLink) => !touchesAny(ids)(transformLink)),
  }
}

// Keeps the template transforms that fill a free target from fields the sample has; dropping one
// can leave a transform that fed it without any use, so this repeats until nothing changes.
function fittingTransforms(
  record: MappingDraftRecord,
  leaves: ReturnType<typeof sideLeaves>,
  taken: ReadonlySet<string>,
): TransformGraph {
  let graph = withoutInvalidTransforms(templateGraph(record.id, record.messageType, 1, 'ai'))

  for (;;) {
    const unknown = unknownPaths({ links: [], ...graph }, leaves)

    const unfit = new Set(
      graph.transforms
        .filter(({ id }) => {
          const own = graph.transformLinks.filter(touchesAny(new Set([id])))
          const feeds = own.some(({ from }) => from.kind === 'transform' && from.transformId === id)

          return (
            !feeds ||
            own.some(
              ({ from, to }) =>
                (from.kind === 'source' && unknown.source.has(from.path)) ||
                (to.kind === 'target' && (unknown.target.has(to.path) || taken.has(to.path))),
            )
          )
        })
        .map(({ id }) => id),
    )

    if (unfit.size === 0) {
      return graph
    }

    graph = withoutInvalidTransforms(withoutTransforms(graph, unfit))
  }
}

function generatedLinks(
  record: MappingDraftRecord,
  leaves: ReturnType<typeof sideLeaves>,
  taken: ReadonlySet<string>,
): MappingLink[] {
  const faker = seededFaker(`ai-draft:${record.id}`)
  const sources = [...leaves.source]

  return faker.helpers
    .shuffle([...leaves.target].filter((path) => !taken.has(path)))
    .map((targetPath) => ({ sourcePath: faker.helpers.arrayElement(sources), targetPath }))
}

function templateLinksFor(
  record: MappingDraftRecord,
  leaves: ReturnType<typeof sideLeaves>,
  taken: ReadonlySet<string>,
): MappingLink[] {
  return linkTemplates[record.messageType]
    .map((pair) => link(record.messageType, pair))
    .filter(
      ({ sourcePath, targetPath }) =>
        leaves.source.has(sourcePath) && leaves.target.has(targetPath) && !taken.has(targetPath),
    )
}

export function aiProposalFor(
  record: MappingDraftRecord,
  documentStructures: ReadonlyArray<DocumentStructure>,
  size: AiProposalSize = 'regular',
): AiProposal {
  if (size === 'empty') {
    return { links: [], transforms: [], transformLinks: [] }
  }

  const leaves = sideLeaves(record, documentStructures)

  const linked = new Set([
    ...record.links.map(({ targetPath }) => targetPath),
    ...transformLinkTargets(record.transformLinks),
  ])

  const transforms = fittingTransforms(record, leaves, linked)
  const taken = new Set([...linked, ...transformLinkTargets(transforms.transformLinks)])

  const links =
    size === 'large'
      ? generatedLinks(record, leaves, taken)
      : templateLinksFor(record, leaves, taken)

  return { links, ...transforms }
}

function reviewOf(sampleId: string, proposal: AiProposal): AiReview | null {
  const empty =
    proposal.links.length + proposal.transforms.length + proposal.transformLinks.length === 0

  return empty
    ? null
    : {
        sampleId,
        proposedLinks: proposal.links.map(({ targetPath }) => targetPath),
        proposedTransforms: proposal.transforms.map(({ id }) => id),
        proposedTransformLinks: proposal.transformLinks.map(transformLinkKey),
      }
}

// Puts the proposal into the Draft and marks it for review, as the api does once it passed the
// check; stories use it to start from a Draft whose AI review is open.
export function withAiProposal(
  record: MappingDraftRecord,
  sampleId: string,
  proposal: AiProposal,
): MappingDraftRecord {
  const review = reviewOf(sampleId, proposal)

  return review
    ? {
        ...record,
        links: [...record.links, ...proposal.links],
        transforms: [...record.transforms, ...proposal.transforms],
        transformLinks: [...record.transformLinks, ...proposal.transformLinks],
        aiReview: review,
        unpublishedChanges: true,
        updatedAt: new Date().toISOString(),
      }
    : record
}

function segmentTags(proposal: AiProposal) {
  const paths = [
    ...proposal.links.flatMap(({ sourcePath, targetPath }) => [sourcePath, targetPath]),
    ...proposal.transformLinks.flatMap(({ from, to }) => [
      ...(from.kind === 'source' ? [from.path] : []),
      ...(to.kind === 'target' ? [to.path] : []),
    ]),
  ]

  const tags = new Set(
    paths.flatMap((path) =>
      path.split('/').flatMap((part) => /^([A-Z]{3})(\+|$)/.exec(part)?.[1] ?? []),
    ),
  )

  return tags.size > 0 ? [...tags] : ['BGM']
}

function linkCountOf(proposal: AiProposal) {
  return proposal.links.length + proposal.transformLinks.length
}

function stepsFor(state: AiDraftState, proposal: AiProposal): AiDraftStep[] {
  const reading: AiDraftStep[] = [
    { kind: 'readingSample', round: 1 },
    { kind: 'lookingUpSegments', round: 1, segmentTags: segmentTags(proposal) },
  ]

  const count = linkCountOf(proposal)

  if (state === 'loading') {
    return reading
  }

  if (count === 0) {
    return [
      ...reading,
      { kind: 'linksDrafted', round: 1, linkCount: 0 },
      { kind: 'checkingAgainstSample', round: 1 },
    ]
  }

  const round = (number: number, linkCount: number, errorCount: number): AiDraftStep[] => [
    { kind: 'linksDrafted', round: number, linkCount },
    { kind: 'checkingAgainstSample', round: number },
    { kind: 'fixingErrors', round: number, errorCount },
  ]

  if (state === 'error') {
    return [...reading, ...round(1, count + 2, 3), ...round(2, count + 1, 2), ...round(3, count, 1)]
  }

  return [
    ...reading,
    ...round(1, count + 2, 2),
    { kind: 'linksDrafted', round: 2, linkCount: count },
    { kind: 'checkingAgainstSample', round: 2 },
  ]
}

function aborted(signals: ReadonlyArray<AbortSignal | undefined>) {
  return signals.some((signal) => signal?.aborted)
}

function pause(ms: number, signals: ReadonlyArray<AbortSignal | undefined>) {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(done, ms)

    function done() {
      clearTimeout(timer)

      for (const signal of signals) {
        signal?.removeEventListener('abort', done)
      }

      resolve()
    }

    for (const signal of signals) {
      signal?.addEventListener('abort', done, { once: true })
    }
  })
}

export function aiDraftHandlers(
  apiUrl: string,
  {
    mappings,
    samples = seedMappingSamples,
    documentStructures = seedDocumentStructures,
    session = seedSession,
    settings = seedWorkspaceSettings,
    state = 'proposing',
    stepDelayMs = 700,
    signal,
  }: AiDraftOptions = {},
) {
  const store = toMappingDraftStore(mappings)
  const structures = toDocumentStructureStore(documentStructures)
  const sessionStore = toSessionStore(session)
  const settingsStore = toWorkspaceSettingsStore(settings)

  function budgetOf(workspaceId: string): AiBudget {
    const { dailyLimit, usedToday } = settingsStore.get(workspaceId).aiTokenBudget

    return {
      dailyLimit,
      usedToday: state === 'budgetExhausted' ? Math.max(dailyLimit, usedToday) : usedToday,
      resetsAt: nextMidnight(new Date()),
    }
  }

  function spend(workspaceId: string) {
    const current = settingsStore.get(workspaceId)

    settingsStore.set(workspaceId, {
      ...current,
      aiTokenBudget: {
        ...current.aiTokenBudget,
        usedToday: current.aiTokenBudget.usedToday + aiDraftTokens,
      },
    })
  }

  function stream(
    record: MappingDraftRecord,
    sampleId: string,
    workspaceId: string,
    request: Request,
  ) {
    const proposal = aiProposalFor(record, structures.all(), proposalSizes[state])
    const steps = stepsFor(state, proposal)
    const signals = [request.signal, signal]

    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        for (const step of steps) {
          await pause(stepDelayMs, signals)

          if (aborted(signals)) {
            controller.close()

            return
          }

          controller.enqueue(frameOf({ type: 'step', step }))
        }

        if (state === 'loading') {
          await new Promise<void>((resolve) => {
            for (const each of signals) {
              each?.addEventListener('abort', () => resolve(), { once: true })
            }
          })
          controller.close()

          return
        }

        await pause(stepDelayMs, signals)

        if (aborted(signals)) {
          controller.close()

          return
        }

        spend(workspaceId)

        if (state === 'error') {
          controller.enqueue(frameOf({ type: 'failed', reason: 'checkFailed' }))
          controller.close()

          return
        }

        const current = store.get(record.id) ?? record
        const drafted = withAiProposal(current, sampleId, proposal)
        store.set(drafted)

        controller.enqueue(
          frameOf({ type: 'drafted', proposal, draft: toMappingDraft(drafted, structures.all()) }),
        )
        controller.close()
      },
    })

    return new HttpResponse(body, {
      headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' },
    })
  }

  return [
    http.get(
      `${apiUrl}${aiBudgetEndpoint.path}`,
      adminOnly(sessionStore, (_, { workspace }) => HttpResponse.json(budgetOf(workspace.id))),
    ),
    http.post<{ id: string }>(
      `${apiUrl}${requestAiDraftEndpoint.path}`,
      adminOnly(sessionStore, async ({ params, request }, { workspace }) => {
        const record = store.get(params.id)

        if (!record) {
          return notFound()
        }

        const body = requestAiDraftEndpoint.body.safeParse(await request.json())

        if (!body.success) {
          return badRequest(body.error.message)
        }

        const sample = samples.find(
          ({ id, mappingId }) => id === body.data.sampleId && mappingId === record.id,
        )

        if (!sample) {
          return notFound()
        }

        if (record.aiReview) {
          return aiReviewOpen()
        }

        const budget = budgetOf(workspace.id)

        if (aiBudgetExhausted(budget)) {
          return HttpResponse.json(
            {
              code: 'aiBudgetExhausted',
              message: 'The daily AI budget of the Workspace is used up.',
              budget,
            } satisfies AiBudgetExhaustedProblem,
            { status: aiBudgetExhaustedStatus },
          )
        }

        return stream(record, sample.id, workspace.id, request)
      }),
    ),
    http.post<{ id: string }>(
      `${apiUrl}${acceptAiDraftEndpoint.path}`,
      adminOnly(sessionStore, async ({ params }) => {
        const record = store.get(params.id)

        await delay()

        if (!record) {
          return notFound()
        }

        if (!record.aiReview) {
          return conflict('The Draft has no open AI review.')
        }

        const accepted = { ...record, aiReview: null, updatedAt: new Date().toISOString() }
        store.set(accepted)

        return HttpResponse.json(toMappingDraft(accepted, structures.all()))
      }),
    ),
  ]
}
