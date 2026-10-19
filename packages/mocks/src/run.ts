import { en, Faker, faker as defaultFaker } from '@faker-js/faker'
import { http, HttpResponse } from 'msw'

import {
  directionOf,
  type FailureStage,
  fromSearchParams,
  type MessageType,
  type RunListQuery,
  runsEndpoint,
  type RunStatus,
  type RunSummary,
  runSummarySchema,
} from '@edi-bridge/contracts'

import {
  type FlowRecord,
  type FlowStore,
  type MappingCatalogue,
  type MappingRecord,
  seedFlows,
  seedMappings,
  toFlowStore,
  toMappingCatalogue,
} from './flow'
import { hash } from './hash'
import { problemReasonOf } from './interchange'
import { includesText, pageOf } from './list'
import { badRequest } from './responses'
import { createRunStore, interchangeIdOf, type RunStore, toRunStore } from './run-store'
import { seedTradingPartners } from './trading-partner'

export type RunFields = Pick<
  RunSummary,
  | 'id'
  | 'receivedAt'
  | 'tradingPartner'
  | 'messageType'
  | 'flow'
  | 'manualSubmission'
  | 'status'
  | 'failureStage'
> & { businessReference?: string | null; defect?: boolean | undefined }

// A CONTRL acknowledges a whole Interchange, so it carries no Business Reference.
function businessReferenceOf({ id, messageType }: Pick<RunSummary, 'id' | 'messageType'>) {
  return messageType === 'CONTRL'
    ? null
    : `PO${String(hash(`business-reference:${id}`) % 1_000_000).padStart(6, '0')}`
}

// The Run Store places each Run in its Interchange.
export function toRunSummary({ defect, ...run }: RunFields): RunSummary {
  const { failureStage } = run

  return runSummarySchema.parse({
    ...run,
    problem:
      failureStage === null ? null : { reason: problemReasonOf({ ...run, defect, failureStage }) },
    direction: directionOf(run),
    businessReference:
      run.businessReference === undefined ? businessReferenceOf(run) : run.businessReference,
    interchange: null,
  })
}

export function pickFailureStage(faker: Faker, messageType: MessageType): FailureStage {
  // Outbound Documents come from the ERP as JSON or CSV, so they never fail at EDIFACT parsing.
  // A CONTRL is linked to its Interchange, not mapped, so no Mapping Version could fix it.
  const stages: FailureStage[] =
    directionOf({ messageType }) === 'outbound'
      ? ['mapping', 'validation', 'delivery']
      : messageType === 'CONTRL'
        ? ['parse', 'validation', 'delivery']
        : ['parse', 'validation', 'mapping', 'delivery']

  return faker.helpers.arrayElement(stages)
}

// A Trading Partner in Test Mode has exchanged only a few test Interchanges, and no CONTRL arrives
// before onboarding records one.
const weightedFlows = seedFlows.flatMap((flow) => {
  const tradingPartner = seedTradingPartners.find(({ id }) => id === flow.tradingPartnerId)!

  if (flow.messageType === 'CONTRL' && tradingPartner.onboarding.contrlReceivedAt === null) {
    return []
  }

  return [{ value: { flow, tradingPartner }, weight: tradingPartner.testMode ? 0.003 : 1 }]
})

export function generateRun(faker: Faker, receivedAt: Date): RunFields {
  const { flow, tradingPartner } = faker.helpers.weightedArrayElement(weightedFlows)

  const status = faker.helpers.weightedArrayElement<RunStatus>([
    { value: 'delivered', weight: 78 },
    { value: 'failed', weight: 10 },
    { value: 'duplicate', weight: 5 },
    { value: 'processing', weight: 4 },
    { value: 'received', weight: 3 },
  ])

  return {
    id: faker.string.uuid(),
    status,
    failureStage: status === 'failed' ? pickFailureStage(faker, flow.messageType) : null,
    receivedAt: receivedAt.toISOString(),
    tradingPartner,
    messageType: flow.messageType,
    flow: { id: flow.id, name: flow.name },
    manualSubmission: faker.datatype.boolean({ probability: 0.04 }),
  }
}

export function createRun(
  overrides: Partial<RunSummary> & Pick<RunFields, 'defect'> = {},
): RunSummary {
  return toRunSummary({
    ...generateRun(defaultFaker, defaultFaker.date.recent({ days: 30 })),
    ...overrides,
  })
}

type Order = { receivedAt: number; businessReference: string | null }

function latestBefore<T extends { receivedAt: number }>(
  entries: ReadonlyArray<T>,
  receivedAt: number,
) {
  let low = 0
  let high = entries.length

  while (low < high) {
    const middle = (low + high) >>> 1

    if (entries[middle]!.receivedAt < receivedAt) {
      low = middle + 1
    } else {
      high = middle
    }
  }

  return entries[low - 1]
}

// A Trading Partner answers many of its ORDERS with a DESADV and an INVOIC for the same order.
function followOrders(runs: ReadonlyArray<RunFields>): RunFields[] {
  const ordersByTradingPartner = new Map<string, Order[]>()

  for (const run of runs) {
    if (run.messageType === 'ORDERS') {
      const orders = ordersByTradingPartner.get(run.tradingPartner.id) ?? []
      orders.push({
        receivedAt: Date.parse(run.receivedAt),
        businessReference: businessReferenceOf(run),
      })
      ordersByTradingPartner.set(run.tradingPartner.id, orders)
    }
  }

  for (const orders of ordersByTradingPartner.values()) {
    orders.sort((a, b) => a.receivedAt - b.receivedAt)
  }

  return runs.map((run) => {
    const orders = ordersByTradingPartner.get(run.tradingPartner.id)

    if (
      !orders ||
      (run.messageType !== 'DESADV' && run.messageType !== 'INVOIC') ||
      hash(`follows-order:${run.id}`) % 10 >= 4
    ) {
      return run
    }

    const order = latestBefore(orders, Date.parse(run.receivedAt))

    return order ? { ...run, businessReference: order.businessReference } : run
  })
}

type Original = Order & { controlReference: string }

// A Duplicate is an Interchange received again, so it repeats the control reference and the
// Business Reference of an earlier Interchange from the same Trading Partner.
function receiveAgain(runs: ReadonlyArray<RunSummary>): RunSummary[] {
  const originalsByFlow = new Map<string, Original[]>()
  const flowKeyOf = (run: RunSummary) => `${run.tradingPartner.id}|${run.flow.id}`

  for (const run of runs) {
    if (run.status !== 'duplicate' && run.interchange !== null) {
      const originals = originalsByFlow.get(flowKeyOf(run)) ?? []
      originals.push({
        receivedAt: Date.parse(run.receivedAt),
        businessReference: run.businessReference,
        controlReference: run.interchange.controlReference,
      })
      originalsByFlow.set(flowKeyOf(run), originals)
    }
  }

  for (const originals of originalsByFlow.values()) {
    originals.sort((a, b) => a.receivedAt - b.receivedAt)
  }

  return runs.map((run) => {
    if (run.status !== 'duplicate' || run.interchange?.id !== interchangeIdOf(run)) {
      return run
    }

    const original = latestBefore(
      originalsByFlow.get(flowKeyOf(run)) ?? [],
      Date.parse(run.receivedAt),
    )

    return original
      ? {
          ...run,
          businessReference: original.businessReference,
          interchange: { ...run.interchange, controlReference: original.controlReference },
        }
      : run
  })
}

export function createRuns({
  count,
  now = new Date(),
  days = 30,
  seed = 7,
}: {
  count: number
  now?: Date
  days?: number
  seed?: number
}): RunSummary[] {
  const faker = new Faker({ locale: [en], seed })
  const from = new Date(now.getTime() - days * 24 * 60 * 60 * 1000)

  const runs: RunFields[] = []

  while (runs.length < count) {
    const run = generateRun(faker, faker.date.between({ from, to: now }))

    // Retailers often bundle several ORDERS into one Interchange, which is split into one Run each.
    const bundled =
      run.messageType === 'ORDERS' && faker.datatype.boolean({ probability: 0.2 })
        ? faker.number.int({ min: 1, max: 3 })
        : 0

    const siblings = Array.from({ length: bundled }, () => ({
      ...generateRun(faker, new Date(run.receivedAt)),
      tradingPartner: run.tradingPartner,
      messageType: run.messageType,
      flow: run.flow,
    }))

    runs.push(run, ...siblings)
  }

  const placed = createRunStore(followOrders(runs.slice(0, count)).map(toRunSummary)).all()

  return createRunStore(receiveAgain(placed)).all().slice()
}

let seedRunsCache: RunSummary[] | undefined

export function seedRuns() {
  seedRunsCache ??= createRuns({ count: 12_000 })

  return seedRunsCache
}

function matchesExceptStatus(
  run: RunSummary,
  query: RunListQuery,
  text: string,
  mappingOfFlow: (flowId: string) => string | undefined,
) {
  const receivedAt = Date.parse(run.receivedAt)
  const mappingId = query.mappingId?.length ? mappingOfFlow(run.flow.id) : undefined

  return (
    (text === '' ||
      includesText(run.businessReference, text) ||
      includesText(run.tradingPartner.name, text)) &&
    (!query.failureStage?.length ||
      (run.failureStage !== null && query.failureStage.includes(run.failureStage))) &&
    (!query.tradingPartnerId?.length || query.tradingPartnerId.includes(run.tradingPartner.id)) &&
    (!query.messageType?.length || query.messageType.includes(run.messageType)) &&
    (!query.flowId?.length || query.flowId.includes(run.flow.id)) &&
    (!query.mappingId?.length ||
      (mappingId !== undefined && query.mappingId.includes(mappingId))) &&
    (query.receivedFrom === undefined || receivedAt >= Date.parse(query.receivedFrom)) &&
    (query.receivedTo === undefined || receivedAt <= Date.parse(query.receivedTo)) &&
    (query.manualSubmission === undefined || run.manualSubmission === query.manualSubmission)
  )
}

export function runsHandler(
  apiUrl: string,
  runs?: ReadonlyArray<RunSummary> | RunStore,
  {
    flows = seedFlows,
    mappings = seedMappings,
  }: {
    flows?: ReadonlyArray<FlowRecord> | FlowStore
    mappings?: ReadonlyArray<MappingRecord> | MappingCatalogue
  } = {},
) {
  let store: RunStore | undefined
  const flowStore = toFlowStore(flows)
  const catalogue = toMappingCatalogue(mappings)

  return http.get(`${apiUrl}${runsEndpoint.path}`, ({ request }) => {
    const query = runsEndpoint.query.safeParse(fromSearchParams(new URL(request.url).searchParams))

    if (!query.success) {
      return badRequest(query.error.message)
    }

    store ??= toRunStore(runs ?? seedRuns())
    const { status } = query.data
    const text = query.data.q?.toLowerCase() ?? ''

    const mappingOfFlow = (flowId: string) => {
      const flow = flowStore.get(flowId)

      return flow && catalogue.find(flow.mappingVersionId)?.mapping.mappingId
    }

    const statusCounts: Record<RunStatus, number> = {
      received: 0,
      processing: 0,
      delivered: 0,
      failed: 0,
      duplicate: 0,
    }

    const filtered: RunSummary[] = []

    for (const run of store.newestFirst()) {
      if (!matchesExceptStatus(run, query.data, text, mappingOfFlow)) {
        continue
      }

      statusCounts[run.status] += 1

      if (!status?.length || status.includes(run.status)) {
        filtered.push(run)
      }
    }

    const { items, ...paging } = pageOf(filtered, query.data)

    return HttpResponse.json({ runs: items, statusCounts, ...paging })
  })
}
