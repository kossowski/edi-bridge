import { delay, http, HttpResponse } from 'msw'

import {
  fromSearchParams,
  type Home,
  homeEndpoint,
  homeKeyNumbersOf,
  type HomeQuery,
  homeSchema,
  type HomeTradingPartner,
  homeWindowSizes,
  type Task,
  type TradingPartner,
} from '@edi-bridge/contracts'

import { badRequest, serverError } from './responses'
import { type RunStore, toRunStore } from './run-store'
import { type TasksData, tasksDataOf, toTasks } from './task'

const minute = 60 * 1000

const day = 24 * 60 * minute

function throughputOf(runs: RunStore, { window }: HomeQuery, now: Date) {
  const { durationMinutes, bucketMinutes } = homeWindowSizes[window]
  const bucketMs = bucketMinutes * minute
  const to = Math.floor(now.getTime() / bucketMs) * bucketMs + bucketMs
  const from = to - durationMinutes * minute

  const throughput = Array.from({ length: durationMinutes / bucketMinutes }, (_, index) => ({
    start: new Date(from + index * bucketMs).toISOString(),
    end: new Date(from + (index + 1) * bucketMs).toISOString(),
    delivered: 0,
    failed: 0,
  }))

  for (const run of runs.all()) {
    const bucket = throughput[Math.floor((Date.parse(run.receivedAt) - from) / bucketMs)]

    if (bucket && (run.status === 'delivered' || run.status === 'failed')) {
      bucket[run.status] += 1
    }
  }

  return { from, to, throughput }
}

function tradingPartnerCardsOf(
  tradingPartners: ReadonlyArray<TradingPartner>,
  runs: RunStore,
  tasks: ReadonlyArray<Task>,
  now: Date,
): HomeTradingPartner[] {
  const startOfToday = Math.floor(now.getTime() / day) * day

  const cards = new Map(
    tradingPartners.map(({ id, name, testMode }) => [
      id,
      { tradingPartner: { id, name }, testMode, documentsToday: 0, openProblems: 0 },
    ]),
  )

  for (const run of runs.all()) {
    const card = cards.get(run.tradingPartner.id)

    if (card && Date.parse(run.receivedAt) >= startOfToday) {
      card.documentsToday += 1
    }
  }

  for (const task of tasks) {
    const card = cards.get(task.tradingPartner.id)

    if (card) {
      card.openProblems += 1
    }
  }

  return [...cards.values()].sort(
    (a, b) =>
      b.openProblems - a.openProblems ||
      b.documentsToday - a.documentsToday ||
      a.tradingPartner.name.localeCompare(b.tradingPartner.name),
  )
}

export function toHome(data: TasksData, query: HomeQuery, now = new Date()): Home {
  const { tradingPartners, overdueAcknowledgements } = data
  const runs = toRunStore(data.runs)
  const { tasks, counts } = toTasks({ runs, tradingPartners, overdueAcknowledgements }, now)
  const { from, to, throughput } = throughputOf(runs, query, now)

  const inProgress = runs
    .all()
    .reduce(
      (sum, { status }) => (status === 'received' || status === 'processing' ? sum + 1 : sum),
      0,
    )

  return homeSchema.parse({
    window: query.window,
    from: new Date(from).toISOString(),
    to: new Date(to).toISOString(),
    keyNumbers: homeKeyNumbersOf(counts, {
      delivered: throughput.reduce((sum, bucket) => sum + bucket.delivered, 0),
      inProgress,
    }),
    throughput,
    tradingPartners: tradingPartnerCardsOf(tradingPartners, runs, tasks, now),
  })
}

export type HomeState = 'empty' | 'large' | 'loading' | 'error'

export function homeHandler(apiUrl: string, source?: TasksData | HomeState) {
  const path = `${apiUrl}${homeEndpoint.path}`

  if (source === 'loading') {
    return http.get(path, async () => {
      await delay('infinite')
    })
  }

  if (source === 'error') {
    return http.get(path, () => serverError())
  }

  let data: TasksData | undefined

  return http.get(path, ({ request }) => {
    data ??= tasksDataOf(source)

    const query = homeEndpoint.query.safeParse(fromSearchParams(new URL(request.url).searchParams))

    if (!query.success) {
      return badRequest(query.error.message)
    }

    return HttpResponse.json(toHome(data, query.data))
  })
}
