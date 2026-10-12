import type { RunStatus } from '@edi-bridge/contracts'

export const statusGroups = ['attention', 'progress', 'done', 'all'] as const

export type StatusGroup = (typeof statusGroups)[number]

export const groupStatuses: Readonly<Record<Exclude<StatusGroup, 'all'>, readonly RunStatus[]>> = {
  attention: ['failed'],
  progress: ['received', 'processing'],
  done: ['delivered', 'duplicate'],
}
