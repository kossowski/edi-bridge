import { delay, http, HttpResponse } from 'msw'

import {
  type ActivityDay,
  activityDays,
  channelDirectionsOf,
  type ChannelSummary,
  directionOf,
  type FlowActivity,
  type FlowSummary,
  neededDirectionsOf,
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

import { allOf, type Listing } from './listing'
import { notFound, serverError } from './responses'
import { type RunStore, toRunStore } from './run-store'
import { type TradingPartnerStore, toTradingPartnerStore } from './trading-partner'
import {
  type WorkspaceActivity,
  workspaceActivityOf,
  type WorkspaceActivityState,
} from './workspace-activity'

type PartnerFlow = Pick<FlowSummary, 'id' | 'name' | 'tradingPartnerId' | 'messageType'>

type PartnerChannel = Pick<ChannelSummary, 'tradingPartnerId' | 'direction'>

export type TradingPartnerActivityData = {
  tradingPartners: ReadonlyArray<TradingPartner> | TradingPartnerStore
  runs: ReadonlyArray<RunSummary> | RunStore
  overdueAcknowledgements: ReadonlyArray<OverdueAcknowledgement>
  flows: Listing<PartnerFlow>
  channels: Listing<PartnerChannel>
}

const day = 24 * 60 * 60 * 1000

function startOfDay(time: number) {
  return Math.floor(time / day) * day
}

type PartnerTraffic = {
  runs: RunSummary[]
  overdueAcknowledgements: OverdueAcknowledgement[]
  flows: PartnerFlow[]
  channels: PartnerChannel[]
}

function noTraffic(): PartnerTraffic {
  return { runs: [], overdueAcknowledgements: [], flows: [], channels: [] }
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

  for (const channel of allOf(data.channels)) {
    if (channel.tradingPartnerId !== null) {
      of(channel.tradingPartnerId).channels.push(channel)
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

function activityOf(
  { id: tradingPartnerId, messageTypes }: Pick<TradingPartner, 'id' | 'messageTypes'>,
  traffic: PartnerTraffic,
) {
  const problems = openProblemsOf(traffic)

  const activity: TradingPartnerActivity = {
    tradingPartnerId,
    runsToday: receivedSince(traffic.runs, windowOf().today).length,
    openProblems: problems.length,
    lastActivityAt: traffic.runs[0]?.receivedAt ?? null,
    channelCount: traffic.channels.length,
    flowCount: traffic.flows.length,
    channelDirections: channelDirectionsOf(traffic.channels),
    neededDirections: neededDirectionsOf({ messageTypes, flows: traffic.flows }),
  }

  return { activity, problems }
}

export function toTradingPartnerActivities(
  data: TradingPartnerActivityData,
): TradingPartnerActivity[] {
  const traffic = trafficOf(data)

  return toTradingPartnerStore(data.tradingPartners)
    .all()
    .map((tradingPartner) =>
      tradingPartnerActivitySchema.parse(
        activityOf(tradingPartner, traffic(tradingPartner.id)).activity,
      ),
    )
}

export function toTradingPartnerActivityDetail(
  data: TradingPartnerActivityData,
  tradingPartner: TradingPartner,
): TradingPartnerActivityDetail {
  const { from } = windowOf()
  const traffic = trafficOf(data)(tradingPartner.id)
  const { activity, problems } = activityOf(tradingPartner, traffic)

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

// Generated workspace activity has no Flow or Channel records, so each partner with Runs gets the
// Flows its Runs name and a Channel in each direction of those Flows.
function withSetupFromRuns(activity: WorkspaceActivity): TradingPartnerActivityData {
  const runs = toRunStore(activity.runs)
  const flows = new Map<string, PartnerFlow>()

  for (const { flow, tradingPartner, messageType } of runs.all()) {
    flows.set(flow.id, { ...flow, tradingPartnerId: tradingPartner.id, messageType })
  }

  const channels = new Map<string, PartnerChannel>()

  for (const flow of flows.values()) {
    const direction = directionOf(flow)

    channels.set(`${flow.tradingPartnerId}:${direction}`, {
      tradingPartnerId: flow.tradingPartnerId,
      direction,
    })
  }

  return { ...activity, runs, flows: [...flows.values()], channels: [...channels.values()] }
}

let largeActivityData: TradingPartnerActivityData | undefined

function activityDataOf(
  source: TradingPartnerActivityData | 'empty' | 'large',
): TradingPartnerActivityData {
  switch (source) {
    case 'empty':
      return withSetupFromRuns(workspaceActivityOf(source))
    case 'large':
      return (largeActivityData ??= withSetupFromRuns(workspaceActivityOf(source)))
    default:
      return { ...source, runs: toRunStore(source.runs) }
  }
}

export function tradingPartnerActivityHandlers(
  apiUrl: string,
  source: TradingPartnerActivityData | WorkspaceActivityState,
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

      const tradingPartner = toTradingPartnerStore(data.tradingPartners).get(params.id)

      if (!tradingPartner) {
        return notFound()
      }

      return HttpResponse.json(toTradingPartnerActivityDetail(data, tradingPartner))
    }),
  ]
}
