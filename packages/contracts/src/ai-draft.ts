import { z } from 'zod'

import {
  aiReviewMarks,
  aiReviewPartsSchema,
  aiReviewPartsSize,
  marksAll,
  proposedAiReview,
} from './ai-review'
import { type Endpoint, type EventStreamEndpoint, parseStreamEvent } from './endpoint'
import { type MappingDraft, mappingDraftSchema, mappingGraphSchema } from './mapping'
import { aiTokenBudgetSchema } from './workspace-settings'

export const requestAiDraftBodySchema = z.object({ sampleId: z.uuid() })

export type RequestAiDraftBody = z.infer<typeof requestAiDraftBodySchema>

// A round starts with drafting links and ends with the check against the Sample Document; each
// fix of the errors the check found starts the next round.
const roundField = { round: z.number().int().min(1) }

export const aiDraftStepSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('readingSample'), ...roundField }),
  z.object({
    kind: z.literal('lookingUpSegments'),
    ...roundField,
    segmentTags: z.array(z.string().min(1)).min(1),
  }),
  z.object({ kind: z.literal('linksDrafted'), ...roundField, linkCount: z.number().int().min(0) }),
  z.object({ kind: z.literal('checkingAgainstSample'), ...roundField }),
  z.object({ kind: z.literal('fixingErrors'), ...roundField, errorCount: z.number().int().min(1) }),
])

export type AiDraftStep = z.infer<typeof aiDraftStepSchema>

export type AiDraftStepKind = AiDraftStep['kind']

export const aiDraftStepEventSchema = z.object({ type: z.literal('step'), step: aiDraftStepSchema })

export type AiDraftStepEvent = z.infer<typeof aiDraftStepEventSchema>

export const aiProposalSchema = mappingGraphSchema

export type AiProposal = z.infer<typeof aiProposalSchema>

// The marks do not depend on the Sample Document, so a Draft without a review needs none.
function marksProposal(proposal: AiProposal, { aiReview }: MappingDraft) {
  const proposed = proposedAiReview(aiReview?.sampleId ?? '', proposal)

  return proposed === null || (aiReview !== null && marksAll(aiReview, aiReviewMarks(proposed)))
}

export const aiDraftedEventSchema = z
  .object({ type: z.literal('drafted'), proposal: aiProposalSchema, draft: mappingDraftSchema })
  .refine(({ proposal, draft }) => marksProposal(proposal, draft), {
    message: 'The Draft marks every proposed part as AI-proposed',
  })

export type AiDraftedEvent = z.infer<typeof aiDraftedEventSchema>

export const aiDraftFailureReasons = ['checkFailed', 'budgetExhausted', 'unavailable'] as const

export type AiDraftFailureReason = (typeof aiDraftFailureReasons)[number]

export const aiDraftFailedEventSchema = z.object({
  type: z.literal('failed'),
  reason: z.enum(aiDraftFailureReasons),
})

export type AiDraftFailedEvent = z.infer<typeof aiDraftFailedEventSchema>

export const aiDraftEventSchema = z.discriminatedUnion('type', [
  aiDraftStepEventSchema,
  aiDraftedEventSchema,
  aiDraftFailedEventSchema,
])

export type AiDraftEvent = z.infer<typeof aiDraftEventSchema>

export const requestAiDraftEndpoint: EventStreamEndpoint<
  AiDraftEvent,
  RequestAiDraftBody,
  '/mappings/:id/ai-draft'
> = {
  method: 'POST',
  path: '/mappings/:id/ai-draft',
  body: requestAiDraftBodySchema,
  event: aiDraftEventSchema,
}

export function parseAiDraftEvent(data: string): AiDraftEvent | null {
  return parseStreamEvent(requestAiDraftEndpoint, data)
}

export const acceptAiDraftEndpoint: Endpoint<
  MappingDraft,
  undefined,
  undefined,
  '/mappings/:id/ai-draft/accept'
> = {
  method: 'POST',
  path: '/mappings/:id/ai-draft/accept',
  response: mappingDraftSchema,
}

export const acceptAiProposedPartsBodySchema = aiReviewPartsSchema.refine(
  (parts) => aiReviewPartsSize(parts) > 0,
  { message: 'Accept at least one AI-proposed part' },
)

export type AcceptAiProposedPartsBody = z.infer<typeof acceptAiProposedPartsBodySchema>

// Accepting parts drops their marks from the AI review; once no mark is left, the review closes
// and the returned Draft's `aiReview` is null.
export const acceptAiProposedPartsEndpoint: Endpoint<
  MappingDraft,
  undefined,
  AcceptAiProposedPartsBody,
  '/mappings/:id/ai-draft/accept-parts'
> = {
  method: 'POST',
  path: '/mappings/:id/ai-draft/accept-parts',
  body: acceptAiProposedPartsBodySchema,
  response: mappingDraftSchema,
}

// Answered when publishing, or asking for another AI draft, while the Draft's AI review is open.
export const aiReviewOpenStatus = 423

export const aiBudgetExhaustedStatus = 429

export const aiBudgetSchema = aiTokenBudgetSchema.extend({ resetsAt: z.iso.datetime() })

export type AiBudget = z.infer<typeof aiBudgetSchema>

export function aiBudgetExhausted({ dailyLimit, usedToday }: AiBudget) {
  return usedToday >= dailyLimit
}

export const aiBudgetEndpoint: Endpoint<AiBudget> = {
  method: 'GET',
  path: '/workspaces/current/ai-budget',
  response: aiBudgetSchema,
}

export const aiBudgetExhaustedProblemSchema = z.object({
  code: z.literal('aiBudgetExhausted'),
  message: z.string().min(1),
  budget: aiBudgetSchema,
})

export type AiBudgetExhaustedProblem = z.infer<typeof aiBudgetExhaustedProblemSchema>
