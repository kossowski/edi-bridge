import { z } from 'zod'

import { transformLinkKey } from './ai-review'
import { type MappingDraft, mappingDraftSchema, mappingGraphSchema } from './mapping'
import { aiTokenBudgetSchema } from './workspace-settings'

import type { Endpoint, EventStreamEndpoint } from './endpoint'

export const requestAiDraftBodySchema = z.object({ sampleId: z.uuid() })

export type RequestAiDraftBody = z.infer<typeof requestAiDraftBodySchema>

// A round starts with drafting links and ends with the check against the Sample Document; each
// fix of the errors the check found starts the next round.
const round = { round: z.number().int().min(1) }

export const aiDraftStepSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('readingSample'), ...round }),
  z.object({
    kind: z.literal('lookingUpSegments'),
    ...round,
    segmentTags: z.array(z.string().min(1)).min(1),
  }),
  z.object({ kind: z.literal('linksDrafted'), ...round, linkCount: z.number().int().min(0) }),
  z.object({ kind: z.literal('checkingAgainstSample'), ...round }),
  z.object({ kind: z.literal('fixingErrors'), ...round, errorCount: z.number().int().min(1) }),
])

export type AiDraftStep = z.infer<typeof aiDraftStepSchema>

export type AiDraftStepKind = AiDraftStep['kind']

export const aiDraftStepEventSchema = z.object({ type: z.literal('step'), step: aiDraftStepSchema })

export type AiDraftStepEvent = z.infer<typeof aiDraftStepEventSchema>

export const aiProposalSchema = mappingGraphSchema

export type AiProposal = z.infer<typeof aiProposalSchema>

function marksProposal(proposal: AiProposal, { aiReview }: MappingDraft) {
  const marked = (keys: ReadonlyArray<string> | undefined, key: string) =>
    keys?.includes(key) ?? false

  return (
    proposal.links.every(({ targetPath }) => marked(aiReview?.proposedLinks, targetPath)) &&
    proposal.transforms.every(({ id }) => marked(aiReview?.proposedTransforms, id)) &&
    proposal.transformLinks.every((transformLink) =>
      marked(aiReview?.proposedTransformLinks, transformLinkKey(transformLink)),
    )
  )
}

// Sent once the proposal passed the check; the Draft already holds it, marked for review.
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
  let json: unknown

  try {
    json = JSON.parse(data)
  } catch {
    return null
  }

  const event = requestAiDraftEndpoint.event.safeParse(json)

  return event.success ? event.data : null
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
