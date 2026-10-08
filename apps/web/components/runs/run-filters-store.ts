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
  manualSubmission: ManualSubmissionOption
}

type TimeRangeSelection = Pick<RunFilters, 'timeRange' | 'customFrom' | 'customTo'>

type FacetKey = Exclude<keyof RunFilters, keyof TimeRangeSelection>

export type RunListState = RunFilters & {
  page: number
  pageSize: number
}

type RunFiltersState = RunListState & {
  setFilter: <Key extends FacetKey>(key: Key, value: RunFilters[Key]) => void
  setTradingPartners: (tradingPartnerIds: string[], flows: ReadonlyArray<FlowSummary>) => void
  setTimeRange: (selection: Partial<TimeRangeSelection>) => void
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
  manualSubmission: 'any',
}

const minute = 60 * 1000

const hour = 60 * minute

const presetDurations: Record<Exclude<TimeRange, 'any' | 'custom'>, number> = {
  lastHour: hour,
  last24Hours: 24 * hour,
  last7Days: 7 * 24 * hour,
  last30Days: 30 * 24 * hour,
}

function zoneOffset(instant: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant)

  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((candidate) => candidate.type === type)?.value)

  const wallClock = Date.UTC(
    part('year'),
    part('month') - 1,
    part('day'),
    part('hour'),
    part('minute'),
    part('second'),
  )

  return wallClock - Math.floor(instant / 1000) * 1000
}

// Interpreted in the zone the table displays timestamps in, so a filtered day matches the rows.
function zonedInstant(date: string, time: string, timeZone: string) {
  if (!date) {
    return undefined
  }

  const wallClock = Date.parse(`${date}T${time}Z`)
  // The second pass corrects the offset when the first guess lands across a DST change.
  const guess = wallClock - zoneOffset(wallClock, timeZone)

  return new Date(wallClock - zoneOffset(guess, timeZone)).toISOString()
}

export type TimeRangeContext = {
  now: Date
  timeZone: string
}

function resolveTimeRange(
  { timeRange, customFrom, customTo }: TimeRangeSelection,
  { now, timeZone }: TimeRangeContext,
): Pick<RunListQuery, 'receivedFrom' | 'receivedTo'> {
  switch (timeRange) {
    case 'any':
      return { receivedFrom: undefined, receivedTo: undefined }
    case 'custom':
      return {
        receivedFrom: zonedInstant(customFrom, '00:00:00.000', timeZone),
        receivedTo: zonedInstant(customTo, '23:59:59.999', timeZone),
      }
    default:
      return {
        // Rounded to the minute so the query key stays stable between renders.
        receivedFrom: new Date(
          Math.floor(now.getTime() / minute) * minute - presetDurations[timeRange],
        ).toISOString(),
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
  setTimeRange: (selection) =>
    set((state) => ({
      timeRange: selection.timeRange ?? state.timeRange,
      customFrom: selection.customFrom ?? state.customFrom,
      customTo: selection.customTo ?? state.customTo,
      page: 1,
    })),
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

export function toRunListQuery(state: RunListState, context: TimeRangeContext): RunListQuery {
  return {
    status: state.status,
    failureStage: state.failureStage,
    tradingPartnerId: state.tradingPartnerId,
    messageType: state.messageType,
    flowId: state.flowId,
    ...resolveTimeRange(state, context),
    manualSubmission:
      state.manualSubmission === 'any' ? undefined : state.manualSubmission === 'manual',
    page: state.page,
    pageSize: state.pageSize,
  }
}
