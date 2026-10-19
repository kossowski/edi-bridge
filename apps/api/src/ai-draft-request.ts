import { eq, sql } from 'drizzle-orm'
import { Cause, Effect } from 'effect'

import type { LanguageModel } from 'ai'
import type { Context } from 'effect'
import type { FastifyBaseLogger } from 'fastify'

import {
  type AiDraftEvent,
  type AiProposal,
  proposedAiReview,
  type RequestAiDraftBody,
} from '@edi-bridge/contracts'
import { mappings } from '@edi-bridge/db'

import { recordAiTokenUsage, requireAiBudget } from './ai-budget.js'
import { draftMapping, withProposal } from './ai-draft.js'
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

const reviewOpened: AiDraftEvent = { type: 'failed', reason: 'checkFailed' }

// Merges onto the Draft as it is now, since the Admin may have saved it during the run.
const storeDraft = (id: string, sampleId: string, proposal: AiProposal) =>
  Effect.gen(function* () {
    const aiReview = proposedAiReview(sampleId, proposal)

    if (aiReview !== null) {
      const db = yield* Db
      const workspace = yield* CurrentWorkspace
      const where = inWorkspace(mappings, workspace.id, eq(mappings.id, id))

      const stored = yield* Effect.promise(() =>
        db.transaction(async (tx) => {
          // Locks the row, so a save or another AI draft cannot slip in before the update.
          const [current] = await tx
            .select({ draft: mappings.draft, aiReview: mappings.aiReview })
            .from(mappings)
            .where(where)
            .for('update')

          if (current === undefined) {
            throw new Error(`The Mapping ${id} is gone`)
          }

          if (current.aiReview !== null) {
            return false
          }

          await tx
            .update(mappings)
            .set({
              draft: withProposal(current.draft, proposal),
              aiReview,
              unpublishedChanges: true,
              draftUpdatedAt: sql`now()`,
            })
            .where(where)

          return true
        }),
      )

      if (!stored) {
        return reviewOpened
      }
    }

    const draft = yield* loadMappingDraft(id)

    return { type: 'drafted', proposal, draft } satisfies AiDraftEvent
  })

const drafting = (
  id: string,
  sampleId: string,
  model: LanguageModel | null,
  emit: (event: AiDraftEvent) => void,
  log: FastifyBaseLogger,
): Effect.Effect<AiDraftEvent, never, CurrentWorkspace | Db> => {
  if (model === null) {
    return Effect.succeed(unavailable)
  }

  let tokens = 0

  return draftMapping({
    mappingId: id,
    sampleId,
    model,
    onStep: (step) => emit({ type: 'step', step }),
    onTokens: (used) => {
      tokens = used
    },
  }).pipe(
    Effect.flatMap(({ proposal }) => storeDraft(id, sampleId, proposal)),
    Effect.catchTag('AiDraftFailed', ({ reason }) =>
      Effect.succeed({ type: 'failed', reason } satisfies AiDraftEvent),
    ),
    Effect.catchCause((cause) =>
      Effect.as(
        Effect.sync(() =>
          log.error({ err: Cause.squash(cause) }, 'The AI draft failed unexpectedly'),
        ),
        unavailable,
      ),
    ),
    // Runs when the client goes away too, so cancelling a run does not escape the budget.
    Effect.ensuring(Effect.suspend(() => recordAiTokenUsage(tokens))),
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
  log: FastifyBaseLogger,
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

    return eventStream(services, (emit) => drafting(id, sampleId, model, emit, log))
  })
