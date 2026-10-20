import { z } from 'zod'

export const aiNoticeReasons = ['aiBudgetExhausted', 'aiUnavailable'] as const

export const aiNoticeSchema = z.object({
  reason: z.enum(aiNoticeReasons),
  message: z.string().min(1),
})

export type AiNotice = z.infer<typeof aiNoticeSchema>

export type AiNoticeReason = AiNotice['reason']
