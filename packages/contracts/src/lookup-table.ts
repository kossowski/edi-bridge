import { z } from 'zod'

import { directionOf, directionSchema, messageTypeSchema } from './message-type'
import { tradingPartnerSummarySchema } from './trading-partner'

import type { Endpoint } from './endpoint'

export const lookupTableScopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('workspace') }),
  z.object({ kind: z.literal('tradingPartner'), tradingPartner: tradingPartnerSummarySchema }),
])

export type LookupTableScope = z.infer<typeof lookupTableScopeSchema>

export const maxLookupCodeLength = 70

const codeSchema = z.string().trim().min(1).max(maxLookupCodeLength)

export const lookupTableEntrySchema = z.object({ sourceCode: codeSchema, targetCode: codeSchema })

export type LookupTableEntry = z.infer<typeof lookupTableEntrySchema>

export const lookupTableEntriesSchema = z
  .array(lookupTableEntrySchema)
  .superRefine((entries, context) => {
    const seen = new Set<string>()

    entries.forEach(({ sourceCode }, index) => {
      if (seen.has(sourceCode)) {
        context.addIssue({
          code: 'custom',
          message: 'Source codes must be unique',
          path: [index, 'sourceCode'],
        })
      }

      seen.add(sourceCode)
    })
  })

export const lookupTableKinds = ['units', 'countries', 'addresses', 'other'] as const

export const lookupTableKindSchema = z.enum(lookupTableKinds)

export type LookupTableKind = z.infer<typeof lookupTableKindSchema>

export const lookupTableUseSchema = z
  .object({
    mappingId: z.uuid(),
    name: z.string().min(1),
    messageType: messageTypeSchema,
    direction: directionSchema,
    tradingPartners: z.array(tradingPartnerSummarySchema),
  })
  .refine((use) => use.direction === directionOf(use), {
    message: 'The direction follows from the Message Type',
    path: ['direction'],
  })

export type LookupTableUse = z.infer<typeof lookupTableUseSchema>

export const missingCodeCountsSchema = z.object({
  blocking: z.number().int().nonnegative(),
  upcoming: z.number().int().nonnegative(),
})

export type MissingCodeCounts = z.infer<typeof missingCodeCountsSchema>

export const lookupTableSummarySchema = z.object({
  id: z.uuid(),
  name: z.string().min(1),
  kind: lookupTableKindSchema,
  scope: lookupTableScopeSchema,
  entryCount: z.number().int().nonnegative(),
  uses: z.array(lookupTableUseSchema),
  missingCodeCounts: missingCodeCountsSchema,
  updatedAt: z.iso.datetime(),
})

export type LookupTableSummary = z.infer<typeof lookupTableSummarySchema>

export const codeMeaningSchema = z.object({ code: codeSchema, meaning: z.string().min(1) })

export type CodeMeaning = z.infer<typeof codeMeaningSchema>

export const lookupTableSchema = lookupTableSummarySchema.extend({
  entries: lookupTableEntriesSchema,
  codeMeanings: z.array(codeMeaningSchema),
})

export type LookupTable = z.infer<typeof lookupTableSchema>

export const lookupTableScopeInputSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('workspace') }),
  z.object({ kind: z.literal('tradingPartner'), tradingPartnerId: z.uuid() }),
])

export type LookupTableScopeInput = z.infer<typeof lookupTableScopeInputSchema>

export const lookupTableInputSchema = z.object({
  name: z.string().trim().min(1).max(70),
  kind: lookupTableKindSchema,
  scope: lookupTableScopeInputSchema,
  entries: lookupTableEntriesSchema,
})

export type LookupTableInput = z.infer<typeof lookupTableInputSchema>

export const lookupTablesEndpoint: Endpoint<LookupTableSummary[]> = {
  method: 'GET',
  path: '/lookup-tables',
  response: z.array(lookupTableSummarySchema),
}

export const lookupTableEndpoint: Endpoint<
  LookupTable,
  undefined,
  undefined,
  '/lookup-tables/:id'
> = {
  method: 'GET',
  path: '/lookup-tables/:id',
  response: lookupTableSchema,
}

export const createLookupTableEndpoint: Endpoint<
  LookupTable,
  undefined,
  LookupTableInput,
  '/lookup-tables'
> = {
  method: 'POST',
  path: '/lookup-tables',
  body: lookupTableInputSchema,
  response: lookupTableSchema,
}

export const updateLookupTableEndpoint: Endpoint<
  LookupTable,
  undefined,
  LookupTableInput,
  '/lookup-tables/:id'
> = {
  method: 'PUT',
  path: '/lookup-tables/:id',
  body: lookupTableInputSchema,
  response: lookupTableSchema,
}

export const deleteLookupTableEndpoint: Endpoint<
  undefined,
  undefined,
  undefined,
  '/lookup-tables/:id'
> = {
  method: 'DELETE',
  path: '/lookup-tables/:id',
  response: z.undefined(),
}

export const missingCodeUrgencies = ['blocking', 'upcoming'] as const

export type MissingCodeUrgency = (typeof missingCodeUrgencies)[number]

export const failedRunReferenceSchema = z.object({
  id: z.uuid(),
  receivedAt: z.iso.datetime(),
  tradingPartner: tradingPartnerSummarySchema,
  messageType: messageTypeSchema,
  businessReference: z.string().min(1).nullable(),
})

export type FailedRunReference = z.infer<typeof failedRunReferenceSchema>

const missingCodeFields = {
  code: codeSchema,
  meaning: z.string().min(1).nullable(),
  suggestions: z.array(codeMeaningSchema),
}

export const missingCodeSchema = z.discriminatedUnion('urgency', [
  z.object({
    urgency: z.literal('blocking'),
    ...missingCodeFields,
    failedRuns: z.array(failedRunReferenceSchema).min(1),
  }),
  z.object({
    urgency: z.literal('upcoming'),
    ...missingCodeFields,
    itemCount: z.number().int().positive(),
  }),
])

export type MissingCode = z.infer<typeof missingCodeSchema>

export const missingCodesSchema = z
  .array(missingCodeSchema)
  .refine((codes) => new Set(codes.map(({ code }) => code)).size === codes.length, {
    message: 'A missing code is listed once',
  })

export const lookupTableMissingCodesEndpoint: Endpoint<
  MissingCode[],
  undefined,
  undefined,
  '/lookup-tables/:id/missing-codes'
> = {
  method: 'GET',
  path: '/lookup-tables/:id/missing-codes',
  response: missingCodesSchema,
}

export const lookupTableSuggestionsQuerySchema = z.object({
  kind: lookupTableKindSchema,
  tradingPartnerId: z.uuid().optional(),
})

export type LookupTableSuggestionsQuery = z.infer<typeof lookupTableSuggestionsQuerySchema>

export const suggestedEntrySchema = lookupTableEntrySchema.extend({
  targetMeaning: z.string().min(1).nullable(),
})

export type SuggestedEntry = z.infer<typeof suggestedEntrySchema>

export const lookupTableSuggestionsSchema = z.object({
  entries: z.array(suggestedEntrySchema),
})

export type LookupTableSuggestions = z.infer<typeof lookupTableSuggestionsSchema>

export const lookupTableSuggestionsEndpoint: Endpoint<
  LookupTableSuggestions,
  LookupTableSuggestionsQuery,
  undefined,
  '/lookup-table-suggestions'
> = {
  method: 'GET',
  path: '/lookup-table-suggestions',
  query: lookupTableSuggestionsQuerySchema,
  response: lookupTableSuggestionsSchema,
}

export const maxLookupTableCsvLength = 2_000_000

export const lookupTableImportBodySchema = z.object({
  csv: z.string().max(maxLookupTableCsvLength),
})

export type LookupTableImportBody = z.infer<typeof lookupTableImportBodySchema>

export const lookupTableImportReasons = [
  'columnCount',
  'sourceCodeMissing',
  'targetCodeMissing',
  'sourceCodeTooLong',
  'targetCodeTooLong',
  'duplicateSourceCode',
] as const

export const lookupTableImportReasonSchema = z.enum(lookupTableImportReasons)

export type LookupTableImportReason = z.infer<typeof lookupTableImportReasonSchema>

const line = z.number().int().positive()

const importedEntry = { line, ...lookupTableEntrySchema.shape }

export const lookupTableImportRowSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('added'), ...importedEntry }),
  z.object({ status: z.literal('changed'), ...importedEntry, previousTargetCode: codeSchema }),
  z.object({ status: z.literal('unchanged'), ...importedEntry }),
  z.object({
    status: z.literal('invalid'),
    line,
    cells: z.array(z.string()),
    reasons: z.array(lookupTableImportReasonSchema).min(1),
  }),
])

export type LookupTableImportRow = z.infer<typeof lookupTableImportRowSchema>

export type LookupTableImportStatus = LookupTableImportRow['status']

export const lookupTableImportPreviewSchema = z.object({
  rows: z.array(lookupTableImportRowSchema),
})

export type LookupTableImportPreview = z.infer<typeof lookupTableImportPreviewSchema>

export const lookupTableImportPreviewEndpoint: Endpoint<
  LookupTableImportPreview,
  undefined,
  LookupTableImportBody,
  '/lookup-tables/:id/import-preview'
> = {
  method: 'POST',
  path: '/lookup-tables/:id/import-preview',
  body: lookupTableImportBodySchema,
  response: lookupTableImportPreviewSchema,
}

export const importLookupTableEndpoint: Endpoint<
  LookupTable,
  undefined,
  LookupTableImportBody,
  '/lookup-tables/:id/import'
> = {
  method: 'POST',
  path: '/lookup-tables/:id/import',
  body: lookupTableImportBodySchema,
  response: lookupTableSchema,
}
