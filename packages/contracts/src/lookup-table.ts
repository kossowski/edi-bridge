import { z } from 'zod'

import { tradingPartnerSummarySchema } from './trading-partner'

import type { Endpoint } from './endpoint'

export const lookupTableScopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('workspace') }),
  z.object({ kind: z.literal('tradingPartner'), tradingPartner: tradingPartnerSummarySchema }),
])

export type LookupTableScope = z.infer<typeof lookupTableScopeSchema>

export const lookupCodeMaxLength = 70

const codeSchema = z.string().trim().min(1).max(lookupCodeMaxLength)

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

export const lookupTableSummarySchema = z.object({
  id: z.uuid(),
  name: z.string().min(1),
  scope: lookupTableScopeSchema,
  entryCount: z.number().int().nonnegative(),
  updatedAt: z.iso.datetime(),
})

export type LookupTableSummary = z.infer<typeof lookupTableSummarySchema>

export const lookupTableSchema = lookupTableSummarySchema.extend({
  entries: lookupTableEntriesSchema,
})

export type LookupTable = z.infer<typeof lookupTableSchema>

export const lookupTableScopeInputSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('workspace') }),
  z.object({ kind: z.literal('tradingPartner'), tradingPartnerId: z.uuid() }),
])

export type LookupTableScopeInput = z.infer<typeof lookupTableScopeInputSchema>

export const lookupTableInputSchema = z.object({
  name: z.string().trim().min(1).max(70),
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

const importedEntry = { line: z.number().int().positive(), ...lookupTableEntrySchema.shape }

export const lookupTableImportRowSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('added'), ...importedEntry }),
  z.object({ status: z.literal('changed'), ...importedEntry, previousTargetCode: codeSchema }),
  z.object({ status: z.literal('unchanged'), ...importedEntry }),
  z.object({
    status: z.literal('invalid'),
    line: z.number().int().positive(),
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
