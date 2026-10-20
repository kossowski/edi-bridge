import { z } from 'zod'

import { type CharacterEncoding, characterEncodingSchema } from './document-structure'
import { notRoutedMessagesSchema } from './message-type'
import { runSummarySchema } from './run'

import type { Endpoint } from './endpoint'

export const maxDocumentBytes = 5_000_000

export const maxDocumentBase64Length = Math.ceil(maxDocumentBytes / 3) * 4

const byteLengthOf = (base64: string) =>
  (base64.length / 4) * 3 - (base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0)

// Without an encoding a Document is UTF-8, unless it is an Interchange whose UNB names another.
export const documentSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  content: z
    .base64()
    .min(1)
    .max(maxDocumentBase64Length)
    .refine((content) => byteLengthOf(content) <= maxDocumentBytes, {
      message: `A Document holds at most ${String(maxDocumentBytes)} bytes`,
    }),
  encoding: characterEncodingSchema.optional(),
})

export type SubmittedDocument = z.infer<typeof documentSchema>

export const manualSubmissionInputSchema = z.object({
  channelId: z.uuid(),
  document: documentSchema,
})

export type ManualSubmissionInput = z.infer<typeof manualSubmissionInputSchema>

export const documentUndecodableStatus = 422

export const documentUndecodableProblemSchema = z.object({
  code: z.literal('documentUndecodable'),
  // null when the Interchange names its character set, so another encoding would not help.
  encoding: characterEncodingSchema.nullable(),
  message: z.string().min(1),
  // The decoder's reason without the advice of message, for a screen that gives its own advice.
  reason: z.string().min(1),
})

export type DocumentUndecodableProblem = z.infer<typeof documentUndecodableProblemSchema>

export const documentUndecodableProblem = (
  reason: string,
  encoding: CharacterEncoding | null,
): DocumentUndecodableProblem => ({
  code: 'documentUndecodable',
  encoding,
  message:
    encoding === null
      ? `${reason}.`
      : `${reason}. Choose another encoding, such as Windows-1252 for a typical German CSV.`,
  reason,
})

// One Run per Message: an Interchange with several Messages produces several Runs. A Message
// without a Flow for its Message Type on the Channel gets no Run and is listed as not routed, by the
// raw UNH type, so one unknown Message doesn't block the others.
export const manualSubmissionSchema = z.object({
  runs: z
    .array(runSummarySchema)
    .min(1)
    .refine((runs) => runs.every((run) => run.manualSubmission), {
      message: 'Every Run of a Manual Submission is marked as manual',
    }),
  notRouted: notRoutedMessagesSchema,
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
