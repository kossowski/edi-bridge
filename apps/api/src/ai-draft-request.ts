import { eq, sql } from 'drizzle-orm'
import { Effect } from 'effect'

import type { LanguageModel } from 'ai'
import type { Context } from 'effect'

import {
  type AiDraftEvent,
  type AiProposal,
  type MappingGraph,
  proposedAiReview,
  type RequestAiDraftBody,
} from '@edi-bridge/contracts'
import { mappings } from '@edi-bridge/db'

import { recordAiTokenUsage, requireAiBudget } from './ai-budget.js'
import { draftMapping } from './ai-draft.js'
import { Db } from './db.js'
import { AiReviewOpen, NotFound } from './errors.js'
import { loadSamples } from './mapping-preview.js'
import { loadMappingDraft } from './mapping.js'
import { inWorkspace } from './rows.js'
import { CurrentWorkspace } from './workspace.js'

import type { ValidationError } from './parse.js'

const encoder = new TextEncoder()

const frame = (event: AiDraftEvent) => encoder.encode(`data:${JSON.stringify(event)}\n\n`)

const unavailable: AiDraftEvent = { type: 'failed', reason: 'unavailable' }

const storeDraft = (id: string, sampleId: string, proposal: AiProposal, graph: MappingGraph) =>
  Effect.gen(function* () {
    const aiReview = proposedAiReview(sampleId, proposal)

    if (aiReview !== null) {
      const db = yield* Db
      const workspace = yield* CurrentWorkspace

      yield* Effect.promise(() =>
        db
          .update(mappings)
          .set({ draft: graph, aiReview, unpublishedChanges: true, draftUpdatedAt: sql`now()` })
          .where(inWorkspace(mappings, workspace.id, eq(mappings.id, id))),
      )
    }

    return yield* loadMappingDraft(id)
  })

const drafting = (
  id: string,
  sampleId: string,
  model: LanguageModel | null,
  emit: (event: AiDraftEvent) => void,
): Effect.Effect<AiDraftEvent, never, CurrentWorkspace | Db> => {
  if (model === null) {
    return Effect.succeed(unavailable)
  }

  return draftMapping({
    mappingId: id,
    sampleId,
    model,
    onStep: (step) => emit({ type: 'step', step }),
  }).pipe(
    Effect.tap(({ tokens }) => recordAiTokenUsage(tokens)),
    Effect.flatMap(({ proposal, graph }) =>
      Effect.map(storeDraft(id, sampleId, proposal, graph), (draft): AiDraftEvent => ({
        type: 'drafted',
        proposal,
        draft,
      })),
    ),
    Effect.catchTag('AiDraftFailed', ({ reason, tokens }) =>
      Effect.as(recordAiTokenUsage(tokens), { type: 'failed', reason } satisfies AiDraftEvent),
    ),
    Effect.catchCause(() => Effect.succeed(unavailable)),
  )
}

// Interrupting the run when the client goes away aborts the call to the model.
const eventStream = (
  services: Context.Context<CurrentWorkspace | Db>,
  run: (
    emit: (event: AiDraftEvent) => void,
  ) => Effect.Effect<AiDraftEvent, never, CurrentWorkspace | Db>,
) => {
  const abort = new AbortController()

  return new ReadableStream<Uint8Array>({
    start(controller) {
      const emit = (event: AiDraftEvent) => {
        if (!abort.signal.aborted) {
          controller.enqueue(frame(event))
        }
      }

      Effect.runForkWith(services)(
        run(emit).pipe(
          Effect.map(emit),
          Effect.ensuring(
            Effect.sync(() => {
              if (!abort.signal.aborted) {
                controller.close()
              }
            }),
          ),
        ),
        { signal: abort.signal },
      )
    },
    cancel() {
      abort.abort()
    },
  })
}

export const requestAiDraft = (
  id: string,
  input: Effect.Effect<RequestAiDraftBody, ValidationError>,
  model: LanguageModel | null,
) =>
  Effect.gen(function* () {
    const { mapping, samples } = yield* loadSamples(id)
    const { sampleId } = yield* input

    if (!samples.some((sample) => sample.id === sampleId)) {
      return yield* new NotFound()
    }

    if (mapping.aiReview !== null) {
      return yield* new AiReviewOpen()
    }

    yield* requireAiBudget

    const services = yield* Effect.context<CurrentWorkspace | Db>()

    return eventStream(services, (emit) => drafting(id, sampleId, model, emit))
  })
