import { create } from 'zustand'

import type { FailureStage, MessageType, RunListQuery, RunStatus } from '@edi-bridge/contracts'

export const timeRanges = [
  'any',
  'lastHour',
  'last24Hours',
  'last7Days',
  'last30Days',
  'custom',
] as const

export type TimeRange = (typeof timeRanges)[number]

export const manualSubmissionOptions = ['any', 'manual', 'channel'] as const

export type ManualSubmissionOption = (typeof manualSubmissionOptions)[number]

export const pageSizes = [25, 50, 100] as const

export type RunFilters = {
  status: RunStatus[]
  failureStage: FailureStage[]
  tradingPartnerId: string[]
  messageType: MessageType[]
  flowId: string[]
  timeRange: TimeRange
  // Presets are resolved when chosen, so the query key stays stable between renders.
  receivedFrom: string | undefined
  customFrom: string
  customTo: string
  manualSubmission: ManualSubmissionOption
}

type RunFiltersState = RunFilters & {
  page: number
  pageSize: number
  setFilter: <Key extends keyof RunFilters>(key: Key, value: RunFilters[Key]) => void
  setTimeRange: (timeRange: TimeRange, now?: Date) => void
  setPage: (page: number) => void
  setPageSize: (pageSize: number) => void
  clearFilters: () => void
}

export const emptyRunFilters: RunFilters = {
  status: [],
  failureStage: [],
  tradingPartnerId: [],
  messageType: [],
  flowId: [],
  timeRange: 'any',
  receivedFrom: undefined,
  customFrom: '',
  customTo: '',
  manualSubmission: 'any',
}

const hour = 60 * 60 * 1000

const presetDurations: Record<Exclude<TimeRange, 'any' | 'custom'>, number> = {
  lastHour: hour,
  last24Hours: 24 * hour,
  last7Days: 7 * 24 * hour,
  last30Days: 30 * 24 * hour,
}

export const useRunFilters = create<RunFiltersState>()((set) => ({
  ...emptyRunFilters,
  page: 1,
  pageSize: 50,
  setFilter: (key, value) => set({ [key]: value, page: 1 }),
  setTimeRange: (timeRange, now = new Date()) =>
    set({
      timeRange,
      receivedFrom:
        timeRange === 'any' || timeRange === 'custom'
          ? undefined
          : new Date(now.getTime() - presetDurations[timeRange]).toISOString(),
      page: 1,
    }),
  setPage: (page) => set({ page }),
  setPageSize: (pageSize) => set({ pageSize, page: 1 }),
  clearFilters: () => set({ ...emptyRunFilters, page: 1 }),
}))

export function hasActiveFilters(filters: RunFilters) {
  return (
    filters.status.length > 0 ||
    filters.failureStage.length > 0 ||
    filters.tradingPartnerId.length > 0 ||
    filters.messageType.length > 0 ||
    filters.flowId.length > 0 ||
    filters.timeRange !== 'any' ||
    filters.manualSubmission !== 'any'
  )
}

function startOfDay(date: string) {
  return date ? new Date(`${date}T00:00:00`).toISOString() : undefined
}

function endOfDay(date: string) {
  return date ? new Date(`${date}T23:59:59.999`).toISOString() : undefined
}

export function toRunListQuery(
  filters: RunFilters & { page: number; pageSize: number },
): RunListQuery {
  const custom = filters.timeRange === 'custom'

  return {
    status: filters.status,
    failureStage: filters.failureStage,
    tradingPartnerId: filters.tradingPartnerId,
    messageType: filters.messageType,
    flowId: filters.flowId,
    receivedFrom: custom ? startOfDay(filters.customFrom) : filters.receivedFrom,
    receivedTo: custom ? endOfDay(filters.customTo) : undefined,
    manualSubmission:
      filters.manualSubmission === 'any' ? undefined : filters.manualSubmission === 'manual',
    page: filters.page,
    pageSize: filters.pageSize,
  }
}
