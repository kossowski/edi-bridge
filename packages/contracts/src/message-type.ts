import { z } from 'zod'

export const messageTypes = ['ORDERS', 'DESADV', 'INVOIC', 'CONTRL'] as const

export const messageTypeSchema = z.enum(messageTypes)

export type MessageType = z.infer<typeof messageTypeSchema>
