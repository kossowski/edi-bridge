import { eq, sql } from 'drizzle-orm'
import { Effect } from 'effect'

import {
  type AcceptAiProposedPartsBody,
  acceptedAiReview,
  type AiReview,
  marksAll,
} from '@edi-bridge/contracts'
import { mappings } from '@edi-bridge/db'

import { Db } from './db.js'
import { Conflict } from './errors.js'
import { loadMappingDraft, loadRow } from './mapping.js'
import { inWorkspace } from './rows.js'
import { CurrentWorkspace } from './workspace.js'

import type { ValidationError } from './parse.js'

const noOpenReview = () => new Conflict({ message: 'The Draft has no open AI review.' })

const unmarkedParts = () =>
  new Conflict({ message: 'The AI review does not mark every part to accept.' })

// Locks the row, so a save under way cannot bring back the marks this change drops.
const changeAiReview = (id: string, next: (review: AiReview) => AiReview | null | Conflict) =>
  Effect.gen(function* () {
    const db = yield* Db
    const workspace = yield* CurrentWorkspace
    const where = inWorkspace(mappings, workspace.id, eq(mappings.id, id))

    const refusal = yield* Effect.promise(() =>
      db.transaction(async (tx) => {
        const [locked] = await tx
          .select({ aiReview: mappings.aiReview })
          .from(mappings)
          .where(where)
          .for('update')

        if (!locked?.aiReview) {
          return noOpenReview()
        }

        const aiReview = next(locked.aiReview)

        if (aiReview instanceof Conflict) {
          return aiReview
        }

        await tx
          .update(mappings)
          .set({ aiReview, draftUpdatedAt: sql`now()` })
          .where(where)
      }),
    )

    if (refusal) {
      return yield* Effect.fail(refusal)
    }

    return yield* loadMappingDraft(id)
  })

export const acceptAiDraft = (id: string) =>
  Effect.andThen(
    loadRow(id),
    changeAiReview(id, () => null),
  )

export const acceptAiProposedParts = (
  id: string,
  input: Effect.Effect<AcceptAiProposedPartsBody, ValidationError>,
) =>
  Effect.gen(function* () {
    yield* loadRow(id)
    const parts = yield* input

    return yield* changeAiReview(id, (review) =>
      marksAll(review, parts) ? acceptedAiReview(review, parts) : unmarkedParts(),
    )
  })
