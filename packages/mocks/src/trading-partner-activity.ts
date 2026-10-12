import { delay, http, HttpResponse } from 'msw'

import {
  type ActivityDay,
  activityDays,
  type ChannelSummary,
  type FlowActivity,
  type FlowSummary,
  type OpenProblem,
  openProblemListLimit,
  type OverdueAcknowledgement,
  type RunSummary,
  type TradingPartner,
  tradingPartnerActivitiesEndpoint,
  type TradingPartnerActivity,
  type TradingPartnerActivityDetail,
  tradingPartnerActivityDetailSchema,
  tradingPartnerActivityEndpoint,
  tradingPartnerActivitySchema,
} from '@edi-bridge/contracts'

import { type OverviewData, overviewDataOf, type OverviewState } from './overview'
import { notFound, serverError } from './responses'
import { type RunStore, toRunStore } from './run-store'
import { type TradingPartnerStore, toTradingPartnerStore } from './trading-partner'

type Listing<T> = ReadonlyArray<T> | { all: () => readonly T[] }

type PartnerFlow = Pick<FlowSummary, 'id' | 'name' | 'tradingPartnerId'>

type PartnerChannel = Pick<ChannelSummary, 'tradingPartnerId'>

export type TradingPartnerActivityData = {
  tradingPartners: ReadonlyArray<TradingPartner> | TradingPartnerStore
  runs: ReadonlyArray<RunSummary> | RunStore
  overdueAcknowledgements: ReadonlyArray<OverdueAcknowledgement>
  flows: Listing<PartnerFlow>
  channels: Listing<PartnerChannel>
}

function allOf<T>(listing: Listing<T>): readonly T[] {
  return 'all' in listing ? listing.all() : listing
}

const day = 24 * 60 * 60 * 1000

function startOfDay(time: number) {
  return Math.floor(time / day) * day
}

type PartnerTraffic = {
  runs: RunSummary[]
  overdueAcknowledgements: OverdueAcknowledgement[]
  flows: PartnerFlow[]
  channelCount: number
}

function noTraffic(): PartnerTraffic {
  return { runs: [], overdueAcknowledgements: [], flows: [], channelCount: 0 }
}

function trafficOf(data: TradingPartnerActivityData) {
  const byPartner = new Map<string, PartnerTraffic>()

  function of(id: string) {
    const traffic = byPartner.get(id) ?? noTraffic()
    byPartner.set(id, traffic)

    return traffic
  }

  for (const run of toRunStore(data.runs).newestFirst()) {
    of(run.tradingPartner.id).runs.push(run)
  }

  for (const overdueAcknowledgement of data.overdueAcknowledgements) {
    of(overdueAcknowledgement.tradingPartner.id).overdueAcknowledgements.push(
      overdueAcknowledgement,
    )
  }

  for (const flow of allOf(data.flows)) {
    of(flow.tradingPartnerId).flows.push(flow)
  }

  for (const { tradingPartnerId } of allOf(data.channels)) {
    if (tradingPartnerId !== null) {
      of(tradingPartnerId).channelCount += 1
    }
  }

  return (id: string) => byPartner.get(id) ?? noTraffic()
}

function problemTime(problem: OpenProblem) {
  return Date.parse(
    problem.kind === 'failedRun'
      ? problem.run.receivedAt
      : problem.overdueAcknowledgement.overdueSince,
  )
}

function openProblemsOf({ runs, overdueAcknowledgements }: PartnerTraffic): OpenProblem[] {
  return [
    ...runs.flatMap((run): OpenProblem[] =>
      run.status === 'failed' ? [{ kind: 'failedRun', run }] : [],
    ),
    ...overdueAcknowledgements.map((overdueAcknowledgement): OpenProblem => ({
      kind: 'overdueAcknowledgement',
      overdueAcknowledgement,
    })),
  ].sort((a, b) => problemTime(b) - problemTime(a))
}

function windowOf() {
  const today = startOfDay(Date.now())

  return { today, from: today - (activityDays - 1) * day }
}

function receivedSince(runs: readonly RunSummary[], since: number) {
  return runs.filter(({ receivedAt }) => Date.parse(receivedAt) >= since)
}

function activityOf(tradingPartnerId: string, traffic: PartnerTraffic) {
  const problems = openProblemsOf(traffic)

  const activity: TradingPartnerActivity = {
    tradingPartnerId,
    runsToday: receivedSince(traffic.runs, windowOf().today).length,
    openProblems: problems.length,
    lastActivityAt: traffic.runs[0]?.receivedAt ?? null,
    channelCount: traffic.channelCount,
    flowCount: traffic.flows.length,
  }

  return { activity, problems }
}

export function toTradingPartnerActivities(
  data: TradingPartnerActivityData,
): TradingPartnerActivity[] {
  const traffic = trafficOf(data)

  return toTradingPartnerStore(data.tradingPartners)
    .all()
    .map(({ id }) => tradingPartnerActivitySchema.parse(activityOf(id, traffic(id)).activity))
}

export function toTradingPartnerActivityDetail(
  data: TradingPartnerActivityData,
  tradingPartnerId: string,
): TradingPartnerActivityDetail {
  const { from } = windowOf()
  const traffic = trafficOf(data)(tradingPartnerId)
  const { activity, problems } = activityOf(tradingPartnerId, traffic)

  const days: ActivityDay[] = Array.from({ length: activityDays }, (_, index) => ({
    date: new Date(from + index * day).toISOString().slice(0, 10),
    runs: 0,
    failed: 0,
  }))

  const flows = new Map<string, FlowActivity>(
    traffic.flows.map(({ id, name }) => [id, { flow: { id, name }, runs: 0 }]),
  )

  for (const run of receivedSince(traffic.runs, from)) {
    const bucket = days[Math.floor((Date.parse(run.receivedAt) - from) / day)]

    if (bucket) {
      bucket.runs += 1
      bucket.failed += run.status === 'failed' ? 1 : 0
    }

    const flow = flows.get(run.flow.id)

    if (flow) {
      flow.runs += 1
    }
  }

  return tradingPartnerActivityDetailSchema.parse({
    ...activity,
    days,
    flows: [...flows.values()].sort(
      (a, b) => b.runs - a.runs || a.flow.name.localeCompare(b.flow.name),
    ),
    problems: problems.slice(0, openProblemListLimit),
  })
}

// Generated overview data has no Flow or Channel records, so each partner with Runs gets the
// Flows its Runs name and one Channel.
function withSetupFromRuns(overview: OverviewData): TradingPartnerActivityData {
  const flows = new Map<string, PartnerFlow>()

  for (const { flow, tradingPartner } of toRunStore(overview.runs).all()) {
    flows.set(flow.id, { ...flow, tradingPartnerId: tradingPartner.id })
  }

  const partnersWithRuns = new Set(
    [...flows.values()].map(({ tradingPartnerId }) => tradingPartnerId),
  )

  return {
    ...overview,
    flows: [...flows.values()],
    channels: [...partnersWithRuns].map((tradingPartnerId) => ({ tradingPartnerId })),
  }
}

function activityDataOf(
  source: TradingPartnerActivityData | 'empty' | 'large',
): TradingPartnerActivityData {
  return source === 'empty' || source === 'large'
    ? withSetupFromRuns(overviewDataOf(source))
    : source
}

export function tradingPartnerActivityHandlers(
  apiUrl: string,
  source: TradingPartnerActivityData | OverviewState,
) {
  const listPath = `${apiUrl}${tradingPartnerActivitiesEndpoint.path}`
  const detailPath = `${apiUrl}${tradingPartnerActivityEndpoint.path}`

  if (source === 'loading') {
    const pending = async () => {
      await delay('infinite')
    }

    return [http.get(listPath, pending), http.get(detailPath, pending)]
  }

  if (source === 'error') {
    return [http.get(listPath, () => serverError()), http.get(detailPath, () => serverError())]
  }

  let data: TradingPartnerActivityData | undefined

  return [
    http.get(listPath, () => {
      data ??= activityDataOf(source)

      return HttpResponse.json(toTradingPartnerActivities(data))
    }),
    http.get<{ id: string }>(detailPath, ({ params }) => {
      data ??= activityDataOf(source)

      if (!toTradingPartnerStore(data.tradingPartners).get(params.id)) {
        return notFound()
      }

      return HttpResponse.json(toTradingPartnerActivityDetail(data, params.id))
    }),
  ]
}
