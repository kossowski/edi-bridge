import { z } from 'zod'

import { runSummarySchema } from './run'

import type { Endpoint } from './endpoint'

export const maxDocumentLength = 5_000_000

// EDIFACT, JSON and CSV are all text, so the Document travels as a string inside the JSON body.
export const documentSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  content: z.string().min(1).max(maxDocumentLength),
})

export type SubmittedDocument = z.infer<typeof documentSchema>

export const manualSubmissionInputSchema = z.object({
  channelId: z.uuid(),
  document: documentSchema,
})

export type ManualSubmissionInput = z.infer<typeof manualSubmissionInputSchema>

// One Run per Message: an Interchange with several Messages produces several Runs.
export const manualSubmissionSchema = z.object({
  runs: z
    .array(runSummarySchema)
    .min(1)
    .refine((runs) => runs.every((run) => run.manualSubmission), {
      message: 'Every Run of a Manual Submission is marked as manual',
    }),
})

export type ManualSubmission = z.infer<typeof manualSubmissionSchema>

export const submitDocumentEndpoint: Endpoint<
  ManualSubmission,
  undefined,
  ManualSubmissionInput,
  '/manual-submissions'
> = {
  method: 'POST',
  path: '/manual-submissions',
  body: manualSubmissionInputSchema,
  response: manualSubmissionSchema,
}
