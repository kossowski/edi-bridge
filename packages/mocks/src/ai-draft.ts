import { delay, http, HttpResponse } from 'msw'

import {
  acceptAiDraftEndpoint,
  acceptAiProposedPartsEndpoint,
  acceptedAiReview,
  type AiReviewParts,
  type AiBudget,
  aiBudgetEndpoint,
  aiBudgetExhausted,
  type AiDraftFailureReason,
  type AiDraftStep,
  type AiProposal,
  type AiReview,
  aiReviewKeys,
  type DocumentStructure,
  type MappingLink,
  requestAiDraftEndpoint,
  type Session,
  type TransformLink,
  transformLinkTargets,
  type WorkspaceSettings,
} from '@edi-bridge/contracts'

import {
  type DocumentStructureStore,
  seedDocumentStructures,
  toDocumentStructureStore,
} from './document-structure'
import { eventFrame, eventStreamHeaders } from './event-stream'
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
import { aiBudgetExhaustedProblem, aiReviewOpen, badRequest, conflict, notFound } from './responses'
import { seededFaker } from './seeded-faker'
import { seedSession, toSessionStore } from './session'
import { adminOnly, type SessionStore } from './session-access'
import {
  seedWorkspaceSettings,
  toWorkspaceSettingsStore,
  type WorkspaceSettingsStore,
} from './workspace-settings'

export type AiDraftState =
  | 'proposing'
  | 'empty'
  | 'large'
  | 'loading'
  | 'error'
  | 'budgetExhausted'
  | 'budgetExhaustedMidRun'
  | 'unavailable'

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
  budgetExhaustedMidRun: 'regular',
  unavailable: 'regular',
}

const failureReasons: Partial<Record<AiDraftState, AiDraftFailureReason>> = {
  error: 'checkFailed',
  budgetExhaustedMidRun: 'budgetExhausted',
  unavailable: 'unavailable',
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
  const keys = aiReviewKeys(proposal)
  const empty = keys.links.length + keys.transforms.length + keys.transformLinks.length === 0

  return empty
    ? null
    : {
        sampleId,
        proposedLinks: keys.links,
        proposedTransforms: keys.transforms,
        proposedTransformLinks: keys.transformLinks,
      }
}

// Stories use it to start from a Draft whose AI review is open.
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

function marksAll({ proposedLinks, proposedTransforms, proposedTransformLinks }: AiReview) {
  const marked = (keys: ReadonlyArray<string>, proposed: ReadonlyArray<string>) =>
    keys.every((key) => proposed.includes(key))

  return (parts: AiReviewParts) =>
    marked(parts.links, proposedLinks) &&
    marked(parts.transforms, proposedTransforms) &&
    marked(parts.transformLinks, proposedTransformLinks)
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

function linkCountWithTransformLinks(proposal: AiProposal) {
  return proposal.links.length + proposal.transformLinks.length
}

function stepsFor(state: AiDraftState, proposal: AiProposal): AiDraftStep[] {
  const reading: AiDraftStep[] = [
    { kind: 'readingSample', round: 1 },
    { kind: 'lookingUpSegments', round: 1, segmentTags: segmentTags(proposal) },
  ]

  const count = linkCountWithTransformLinks(proposal)

  if (state === 'loading' || state === 'unavailable') {
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

  if (state === 'budgetExhaustedMidRun') {
    return [...reading, ...round(1, count + 2, 2)]
  }

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

function pause(signals: ReadonlyArray<AbortSignal | undefined>, ms?: number) {
  return new Promise<void>((resolve) => {
    const timer = ms === undefined ? undefined : setTimeout(done, ms)

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

    if (aborted(signals)) {
      done()
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
    const { dailyLimit, usedToday } = current.aiTokenBudget

    settingsStore.set(workspaceId, {
      ...current,
      aiTokenBudget: {
        ...current.aiTokenBudget,
        usedToday:
          state === 'budgetExhaustedMidRun'
            ? Math.max(dailyLimit, usedToday)
            : usedToday + aiDraftTokens,
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
          await pause(signals, stepDelayMs)

          if (aborted(signals)) {
            controller.close()

            return
          }

          controller.enqueue(eventFrame(requestAiDraftEndpoint, { type: 'step', step }))
        }

        if (state === 'loading') {
          await pause(signals)
          controller.close()

          return
        }

        await pause(signals, stepDelayMs)

        if (aborted(signals)) {
          controller.close()

          return
        }

        const failure = failureReasons[state]

        if (failure !== 'unavailable') {
          spend(workspaceId)
        }

        if (failure) {
          controller.enqueue(
            eventFrame(requestAiDraftEndpoint, { type: 'failed', reason: failure }),
          )
          controller.close()

          return
        }

        const current = store.get(record.id) ?? record
        const drafted = withAiProposal(current, sampleId, proposal)
        store.set(drafted)

        controller.enqueue(
          eventFrame(requestAiDraftEndpoint, {
            type: 'drafted',
            proposal,
            draft: toMappingDraft(drafted, structures.all()),
          }),
        )
        controller.close()
      },
    })

    return new HttpResponse(body, { headers: eventStreamHeaders })
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
          return aiBudgetExhaustedProblem(budget)
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
    http.post<{ id: string }>(
      `${apiUrl}${acceptAiProposedPartsEndpoint.path}`,
      adminOnly(sessionStore, async ({ params, request }) => {
        const record = store.get(params.id)

        await delay()

        if (!record) {
          return notFound()
        }

        const body = acceptAiProposedPartsEndpoint.body.safeParse(await request.json())

        if (!body.success) {
          return badRequest(body.error.message)
        }

        if (!record.aiReview) {
          return conflict('The Draft has no open AI review.')
        }

        if (!marksAll(record.aiReview)(body.data)) {
          return conflict('The AI review does not mark every part to accept.')
        }

        const accepted = {
          ...record,
          aiReview: acceptedAiReview(record.aiReview, body.data),
          updatedAt: new Date().toISOString(),
        }

        store.set(accepted)

        return HttpResponse.json(toMappingDraft(accepted, structures.all()))
      }),
    ),
  ]
}
