import { create } from 'zustand'

import type {
  FailureStage,
  FlowSummary,
  MessageType,
  RunListQuery,
  RunStatus,
} from '@edi-bridge/contracts'

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
  customFrom: string
  customTo: string
  // Resolved when the time range is chosen, so the query key stays stable between renders.
  receivedFrom: string | undefined
  receivedTo: string | undefined
  manualSubmission: ManualSubmissionOption
}

type TimeRangeSelection = Pick<RunFilters, 'timeRange' | 'customFrom' | 'customTo'>

type FacetKey = Exclude<keyof RunFilters, keyof TimeRangeSelection | 'receivedFrom' | 'receivedTo'>

export type RunListState = RunFilters & {
  page: number
  pageSize: number
}

type RunFiltersState = RunListState & {
  setFilter: <Key extends FacetKey>(key: Key, value: RunFilters[Key]) => void
  setTradingPartners: (tradingPartnerIds: string[], flows: ReadonlyArray<FlowSummary>) => void
  setTimeRange: (selection: Partial<TimeRangeSelection>, now?: Date) => void
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
  customFrom: '',
  customTo: '',
  receivedFrom: undefined,
  receivedTo: undefined,
  manualSubmission: 'any',
}

const hour = 60 * 60 * 1000

const presetDurations: Record<Exclude<TimeRange, 'any' | 'custom'>, number> = {
  lastHour: hour,
  last24Hours: 24 * hour,
  last7Days: 7 * 24 * hour,
  last30Days: 30 * 24 * hour,
}

function startOfDay(date: string) {
  return date ? new Date(`${date}T00:00:00`).toISOString() : undefined
}

function endOfDay(date: string) {
  return date ? new Date(`${date}T23:59:59.999`).toISOString() : undefined
}

function resolveTimeRange(
  { timeRange, customFrom, customTo }: TimeRangeSelection,
  now: Date,
): Pick<RunFilters, 'receivedFrom' | 'receivedTo'> {
  switch (timeRange) {
    case 'any':
      return { receivedFrom: undefined, receivedTo: undefined }
    case 'custom':
      return { receivedFrom: startOfDay(customFrom), receivedTo: endOfDay(customTo) }
    default:
      return {
        receivedFrom: new Date(now.getTime() - presetDurations[timeRange]).toISOString(),
        receivedTo: undefined,
      }
  }
}

export const useRunFilters = create<RunFiltersState>()((set) => ({
  ...emptyRunFilters,
  page: 1,
  pageSize: 50,
  setFilter: (key, value) => set({ [key]: value, page: 1 }),
  setTradingPartners: (tradingPartnerIds, flows) =>
    set(({ flowId }) => ({
      tradingPartnerId: tradingPartnerIds,
      flowId: flowId.filter((id) =>
        flows.some(
          (flow) =>
            flow.id === id &&
            (tradingPartnerIds.length === 0 || tradingPartnerIds.includes(flow.tradingPartnerId)),
        ),
      ),
      page: 1,
    })),
  setTimeRange: (selection, now = new Date()) =>
    set((state) => {
      const next = {
        timeRange: selection.timeRange ?? state.timeRange,
        customFrom: selection.customFrom ?? state.customFrom,
        customTo: selection.customTo ?? state.customTo,
      }

      return { ...next, ...resolveTimeRange(next, now), page: 1 }
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

export function toRunListQuery(state: RunListState): RunListQuery {
  return {
    status: state.status,
    failureStage: state.failureStage,
    tradingPartnerId: state.tradingPartnerId,
    messageType: state.messageType,
    flowId: state.flowId,
    receivedFrom: state.receivedFrom,
    receivedTo: state.receivedTo,
    manualSubmission:
      state.manualSubmission === 'any' ? undefined : state.manualSubmission === 'manual',
    page: state.page,
    pageSize: state.pageSize,
  }
}
