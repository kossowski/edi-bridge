import { z } from 'zod'

import { tradingPartnerSummarySchema } from './trading-partner'

import type { Endpoint } from './endpoint'

export const lookupTableScopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('workspace') }),
  z.object({ kind: z.literal('tradingPartner'), tradingPartner: tradingPartnerSummarySchema }),
])

export type LookupTableScope = z.infer<typeof lookupTableScopeSchema>

export const lookupTableSummarySchema = z.object({
  id: z.uuid(),
  name: z.string().min(1),
  scope: lookupTableScopeSchema,
})

export type LookupTableSummary = z.infer<typeof lookupTableSummarySchema>

export const lookupTablesEndpoint: Endpoint<LookupTableSummary[]> = {
  method: 'GET',
  path: '/lookup-tables',
  response: z.array(lookupTableSummarySchema),
}
