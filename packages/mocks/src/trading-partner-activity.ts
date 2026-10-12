import { delay, http, HttpResponse } from 'msw'

import {
  type ActivityDay,
  activityDays,
  type FlowActivity,
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

import { createOverviewData, emptyOverviewData, type OverviewState } from './overview'
import { notFound, serverError } from './responses'
import { type RunStore, toRunStore } from './run-store'
import { type TradingPartnerStore, toTradingPartnerStore } from './trading-partner'

export type TradingPartnerActivityData = {
  tradingPartners: ReadonlyArray<TradingPartner> | TradingPartnerStore
  runs: ReadonlyArray<RunSummary> | RunStore
  overdueAcknowledgements: ReadonlyArray<OverdueAcknowledgement>
}

const day = 24 * 60 * 60 * 1000

function startOfDay(time: number) {
  return Math.floor(time / day) * day
}

type Traffic = {
  runs: RunSummary[]
  overdueAcknowledgements: OverdueAcknowledgement[]
}

function trafficOf(data: TradingPartnerActivityData, from: number) {
  const byPartner = new Map<string, Traffic>()

  function of(id: string) {
    let traffic = byPartner.get(id)

    if (!traffic) {
      traffic = { runs: [], overdueAcknowledgements: [] }
      byPartner.set(id, traffic)
    }

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

  return (id: string) => {
    const { runs, overdueAcknowledgements } = byPartner.get(id) ?? {
      runs: [],
      overdueAcknowledgements: [],
    }

    return {
      runs,
      recent: runs.filter(({ receivedAt }) => Date.parse(receivedAt) >= from),
      overdueAcknowledgements,
    }
  }
}

function problemTime(problem: OpenProblem) {
  return Date.parse(
    problem.kind === 'failedRun'
      ? problem.run.receivedAt
      : problem.overdueAcknowledgement.overdueSince,
  )
}

function openProblemsOf(
  recent: readonly RunSummary[],
  overdueAcknowledgements: readonly OverdueAcknowledgement[],
): OpenProblem[] {
  return [
    ...recent.flatMap((run): OpenProblem[] =>
      run.status === 'failed' ? [{ kind: 'failedRun', run }] : [],
    ),
    ...overdueAcknowledgements.map((overdueAcknowledgement): OpenProblem => ({
      kind: 'overdueAcknowledgement',
      overdueAcknowledgement,
    })),
  ].sort((a, b) => problemTime(b) - problemTime(a))
}

function activityOf(
  tradingPartnerId: string,
  { runs, recent, overdueAcknowledgements }: ReturnType<ReturnType<typeof trafficOf>>,
  today: number,
) {
  const problems = openProblemsOf(recent, overdueAcknowledgements)

  const activity: TradingPartnerActivity = {
    tradingPartnerId,
    documentsToday: recent.filter(({ receivedAt }) => Date.parse(receivedAt) >= today).length,
    openProblems: problems.length,
    lastActivityAt: runs[0]?.receivedAt ?? null,
  }

  return { activity, problems }
}

function windowOf(now: number) {
  const today = startOfDay(now)

  return { today, from: today - (activityDays - 1) * day }
}

export function toTradingPartnerActivities(
  data: TradingPartnerActivityData,
  now = Date.now(),
): TradingPartnerActivity[] {
  const { today, from } = windowOf(now)
  const traffic = trafficOf(data, from)

  return toTradingPartnerStore(data.tradingPartners)
    .all()
    .map(({ id }) =>
      tradingPartnerActivitySchema.parse(activityOf(id, traffic(id), today).activity),
    )
}

export function toTradingPartnerActivityDetail(
  data: TradingPartnerActivityData,
  tradingPartnerId: string,
  now = Date.now(),
): TradingPartnerActivityDetail {
  const { today, from } = windowOf(now)
  const traffic = trafficOf(data, from)(tradingPartnerId)
  const { activity, problems } = activityOf(tradingPartnerId, traffic, today)

  const days: ActivityDay[] = Array.from({ length: activityDays }, (_, index) => ({
    date: new Date(from + index * day).toISOString().slice(0, 10),
    documents: 0,
    failed: 0,
  }))

  const flows = new Map<string, FlowActivity>()

  for (const run of traffic.recent) {
    const bucket = days[Math.floor((Date.parse(run.receivedAt) - from) / day)]

    if (bucket) {
      bucket.documents += 1
      bucket.failed += run.status === 'failed' ? 1 : 0
    }

    const flow = flows.get(run.flow.id) ?? { flow: run.flow, documents: 0 }
    flow.documents += 1
    flows.set(run.flow.id, flow)
  }

  return tradingPartnerActivityDetailSchema.parse({
    ...activity,
    lastAcknowledgementAt:
      traffic.runs.find(({ messageType }) => messageType === 'CONTRL')?.receivedAt ?? null,
    days,
    flows: [...flows.values()].sort(
      (a, b) => b.documents - a.documents || a.flow.name.localeCompare(b.flow.name),
    ),
    problems: problems.slice(0, openProblemListLimit),
  })
}

function activityDataOf(
  source: TradingPartnerActivityData | 'empty' | 'large',
): TradingPartnerActivityData {
  switch (source) {
    case 'empty':
      return emptyOverviewData
    case 'large':
      return createOverviewData({ tradingPartnerCount: 240, overdueCount: 400, runCount: 30_000 })
    default:
      return source
  }
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
