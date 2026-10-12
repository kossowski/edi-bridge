import { z } from 'zod'

import { controlReferenceSchema } from './edifact'
import { messageTypeSchema } from './message-type'
import { tradingPartnerSummarySchema } from './trading-partner'

export const overdueAcknowledgementMessageTypes = ['DESADV', 'INVOIC'] as const

export const overdueAcknowledgementSchema = z.object({
  interchange: z.object({ id: z.uuid(), controlReference: controlReferenceSchema }),
  tradingPartner: tradingPartnerSummarySchema,
  messageType: messageTypeSchema.extract(overdueAcknowledgementMessageTypes),
  sentAt: z.iso.datetime(),
  acknowledgementTimeLimitHours: z.number().int().min(1),
  overdueSince: z.iso.datetime(),
})

export type OverdueAcknowledgement = z.infer<typeof overdueAcknowledgementSchema>
