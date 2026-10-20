import { z } from 'zod'

import { notRoutedMessagesSchema } from './message-type'
import { runSummarySchema } from './run'

import type { Endpoint } from './endpoint'

export const maxDocumentBytes = 5_000_000

export const documentEncodings = ['utf-8', 'iso-8859-1', 'windows-1252'] as const

export const documentEncodingSchema = z.enum(documentEncodings)

export type DocumentEncoding = z.infer<typeof documentEncodingSchema>

const byteLengthOf = (base64: string) =>
  (base64.length / 4) * 3 - (base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0)

// The content is base64 of the bytes, so the api decodes them by the rule of the Document: an
// Interchange in the character set its UNB names, any other Document in its encoding.
export const documentSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  content: z
    .base64()
    .min(1)
    .max(Math.ceil(maxDocumentBytes / 3) * 4)
    .refine((content) => byteLengthOf(content) <= maxDocumentBytes, {
      message: `A Document holds at most ${String(maxDocumentBytes)} bytes`,
    }),
  encoding: documentEncodingSchema,
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
  encoding: documentEncodingSchema.nullable(),
  message: z.string().min(1),
})

export type DocumentUndecodableProblem = z.infer<typeof documentUndecodableProblemSchema>

export const documentUndecodableProblem = (
  reason: string,
  encoding: DocumentEncoding | null,
): DocumentUndecodableProblem => ({
  code: 'documentUndecodable',
  encoding,
  message:
    encoding === null
      ? `${reason}.`
      : `${reason}. Choose another encoding, such as Windows-1252 for a typical German CSV.`,
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
