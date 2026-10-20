import { http, HttpResponse } from 'msw'

import {
  directionOf,
  documentRetentionDays,
  type Interchange,
  interchangeEndpoint,
  interchangeSchema,
  type MappingVersionSummary,
  mappingVersionsEndpoint,
  reprocessRunBodySchema,
  reprocessRunEndpoint,
  retryRunEndpoint,
  type RunDetail,
  runDetailSchema,
  runEndpoint,
  type RunStep,
  type RunStepStage,
  type RunSummary,
  runSummarySchema,
  type TradingPartner,
  waitForTradingPartnerRunEndpoint,
  endWaitingForTradingPartnerRunEndpoint,
} from '@edi-bridge/contracts'

import { type ChannelStore, toChannelStore } from './channel'
import { type FlowStore, mappingVersionsForFlow, toFlowStore } from './flow'
import {
  type GeneratedInterchange,
  type GeneratedMessage,
  generateMessage,
  messagePositionOf,
  partiesOf,
  serializeInterchange,
} from './interchange'
import { type LookupTableStore, toLookupTableStore } from './lookup-table'
import {
  mappingVersionEntries,
  type MappingVersionStore,
  toMappingVersionSummary,
} from './mapping-version'
import { seedRuns } from './run'
import { problemOf } from './run-problem'
import { recordedMappingVersionOf, stagesOf, statusOf, stepStatuses } from './run-steps'
import {
  bundleKeyOf,
  type Reprocessed,
  type RunGroup,
  type RunStore,
  toRunStore,
} from './run-store'
import { seededFaker } from './seeded-faker'

import type { TradingPartnerStore } from './trading-partner'

const stepDurations: Readonly<Record<RunStepStage, readonly [number, number]>> = {
  receipt: [20, 200],
  parse: [5, 80],
  validation: [5, 120],
  mapping: [20, 600],
  delivery: [100, 3000],
}

const deliveryTimeout = 30_000

function timeSteps(run: RunSummary, statuses = stepStatuses(run)): RunStep[] {
  const faker = seededFaker(`timing:${run.id}`)
  let clock = Date.parse(run.receivedAt)

  return stagesOf(run).map((stage, index) => {
    const status = statuses[index]!

    if (status === 'pending' || status === 'skipped') {
      return { stage, status, startedAt: null, finishedAt: null }
    }

    const [min, max] = stepDurations[stage]
    const start = clock
    clock +=
      stage === 'delivery' && status === 'failed' ? deliveryTimeout : faker.number.int({ min, max })

    return {
      stage,
      status,
      startedAt: new Date(start).toISOString(),
      finishedAt: status === 'running' ? null : new Date(clock).toISOString(),
    }
  })
}

type GeneratedGroup = {
  messages: ReadonlyMap<string, GeneratedMessage>
  interchange: (GeneratedInterchange & { controlReference: string }) | null
}

// A Run Store already holds its reprocessing links.
export type RunDetailOptions = (
  | { runs?: ReadonlyArray<RunSummary>; reprocessed?: ReadonlyArray<Reprocessed> }
  | { runs: RunStore; reprocessed?: never }
) & {
  mappingVersions?: MappingVersionStore
  flows?: FlowStore
  channels?: ChannelStore
  lookupTables?: LookupTableStore
  waitingForTradingPartnerSince?: Map<string, string>
  documentDeletedAt?: ReadonlyMap<string, string>
  tradingPartners?: ReadonlyArray<TradingPartner> | TradingPartnerStore
}

export function seedReprocessed(runs: ReadonlyArray<RunSummary> = seedRuns()): Reprocessed[] {
  const bundleSizes = Map.groupBy(runs, bundleKeyOf)

  return (['inbound', 'outbound'] as const).flatMap((direction) => {
    const replaced = runs.find(
      (run) =>
        directionOf(run) === direction &&
        run.status === 'failed' &&
        run.failureStage === 'mapping' &&
        run.problem.reason !== 'defect',
    )

    const replacing =
      replaced &&
      runs.find(
        (run) =>
          run.flow.id === replaced.flow.id &&
          run.status === 'delivered' &&
          run.receivedAt > replaced.receivedAt &&
          bundleSizes.get(bundleKeyOf(run))?.length === 1,
      )

    return replacing ? [{ replaced: replaced.id, replacing: replacing.id }] : []
  })
}

// Retention deletes a Document no sooner than its shortest period after it was received.
const shortestRetention = documentRetentionDays.min * 24 * 60 * 60 * 1000

export function seedExpiredDocuments(
  runs: ReadonlyArray<RunSummary> = seedRuns(),
  reprocessed: ReadonlyArray<Reprocessed> = seedReprocessed(runs),
): Map<string, string> {
  const replaced = new Set(reprocessed.map(({ replaced }) => replaced))

  const oldest = runs
    .filter(
      (run) =>
        run.status === 'failed' &&
        run.failureStage === 'mapping' &&
        run.problem.reason !== 'defect' &&
        !replaced.has(run.id) &&
        Date.parse(run.receivedAt) + shortestRetention <= Date.now(),
    )
    .reduce<RunSummary | undefined>(
      (found, run) => (found && found.receivedAt <= run.receivedAt ? found : run),
      undefined,
    )

  return new Map(
    oldest
      ? [[oldest.id, new Date(Date.parse(oldest.receivedAt) + shortestRetention).toISOString()]]
      : [],
  )
}

const documentExpired = 'The Document of the Run expired, so the Run cannot be reprocessed'

// Mirrors the API: the Trading Partner fixes its Document by a resend, a delivery failure by a Retry.
function isReprocessable(
  run: RunDetail,
): run is RunDetail & { mappingVersion: MappingVersionSummary } {
  return (
    run.status === 'failed' &&
    run.failureStage !== 'delivery' &&
    run.problem !== null &&
    run.problem.whoFixes !== 'tradingPartner' &&
    run.mappingVersion !== null &&
    run.replacedBy === null
  )
}

// The api writes no Interchange for an outbound Run that failed at validation, and counts the
// position within the Message alone.
function outboundValidationPosition(run: RunSummary, message: GeneratedMessage) {
  return directionOf(run) === 'outbound' && run.failureStage === 'validation'
    ? messagePositionOf(message)
    : null
}

function problem(status: number, message: string) {
  return HttpResponse.json({ message }, { status })
}

export function runDetailHandlers(apiUrl: string, options: RunDetailOptions = {}) {
  let store: RunStore | undefined
  const generated = new WeakMap<RunGroup, GeneratedGroup>()
  const chosenVersions = new Map<string, MappingVersionSummary>()
  const retried = new Map<string, RunDetail>()
  const deliveringAgain = new Set<string>()
  const waitingSince = options.waitingForTradingPartnerSince ?? new Map<string, string>()
  const documentDeletedAt = options.documentDeletedAt ?? new Map<string, string>()

  const problemSources = {
    flows: toFlowStore(options.flows),
    channels: toChannelStore(options.channels),
    lookupTables: toLookupTableStore(options.lookupTables),
  }

  function runs() {
    store ??= toRunStore(options.runs ?? seedRuns(), options.reprocessed)

    return store
  }

  function generate(group: RunGroup): GeneratedGroup {
    const cached = generated.get(group)

    if (cached) {
      return cached
    }

    const first = group.messageOwners[0]!.run

    const messages = new Map(
      group.messageOwners.map(({ runId, run }, position) => [
        runId,
        generateMessage(run, String(position + 1)),
      ]),
    )

    const result: GeneratedGroup = {
      messages,
      interchange: group.formsInterchange
        ? {
            controlReference: group.controlReference,
            ...serializeInterchange({
              controlReference: group.controlReference,
              parties: partiesOf(first),
              preparedAt: first.receivedAt,
              messages: group.messageOwners.map(({ runId }) => ({
                runId,
                message: messages.get(runId)!,
              })),
            }),
          }
        : null,
    }

    generated.set(group, result)

    return result
  }

  function interchangeOf(group: RunGroup) {
    const { interchange } = generate(group)

    return (
      interchange && {
        id: group.id,
        controlReference: interchange.controlReference,
        raw: interchange.raw,
      }
    )
  }

  // An inbound replacing Run reprocesses the Message of the Run it replaced.
  function messageOwnerOf(group: RunGroup, runId: string) {
    return group.messageOwners.some((owner) => owner.runId === runId)
      ? runId
      : runs().replacedOf(runId)!
  }

  function detail(id: string): RunDetail | undefined {
    const run = runs().get(id)

    if (run === undefined) {
      return undefined
    }

    const retriedDetail = retried.get(id)

    if (retriedDetail) {
      return deliveringAgain.has(id) ? deliverAgain(retriedDetail) : retriedDetail
    }

    const replacing = runs().replacingOf(id)
    const replaced = runs().replacedOf(id)
    const group = runs().groupOf(id)!
    const { messages, interchange } = generate(group)
    const messageOwner = messageOwnerOf(group, id)
    const message = messages.get(messageOwner)!
    const direction = directionOf(run)

    const recorded = recordedMappingVersionOf(run, runs().claimed(id))
    const mappingVersion = recorded && (chosenVersions.get(id) ?? recorded)

    const runError = run.status === 'failed' ? message.error : null

    return runDetailSchema.parse({
      ...run,
      steps: timeSteps(run),
      error: runError && {
        ...runError,
        position: interchange
          ? (interchange.positions.get(messageOwner) ?? null)
          : outboundValidationPosition(run, message),
      },
      problem: runError && problemOf(run, message, mappingVersion, problemSources),
      waitingForTradingPartnerSince: waitingSince.get(id) ?? null,
      duplicateOf: run.status === 'duplicate' ? originalOf(run) : null,
      interchange: interchangeOf(group),
      message:
        statusOf(run, direction === 'inbound' ? 'parse' : 'mapping') === 'succeeded'
          ? message.parsed
          : null,
      mappingVersion,
      replaces: replaced ? { id: replaced } : null,
      replacedBy: replacing ? { id: replacing } : null,
      documentDeletedAt: documentDeletedAt.get(id) ?? null,
    })
  }

  function originalOf(duplicate: RunSummary) {
    const controlReference = duplicate.interchange?.controlReference
    const receivedAt = Date.parse(duplicate.receivedAt)

    if (controlReference === undefined) {
      return null
    }

    const candidates = runs()
      .all()
      .filter(
        (run) =>
          run.status !== 'duplicate' &&
          run.tradingPartner.id === duplicate.tradingPartner.id &&
          run.interchange?.controlReference === controlReference &&
          Date.parse(run.receivedAt) < receivedAt,
      )

    const original =
      candidates.find((run) => run.businessReference === duplicate.businessReference) ??
      candidates[0]

    return original ? { id: original.id } : null
  }

  function waitForTradingPartner(run: RunDetail) {
    const since = waitingSince.get(run.id) ?? new Date().toISOString()
    waitingSince.set(run.id, since)

    return runDetailSchema.parse({ ...run, waitingForTradingPartnerSince: since })
  }

  function storeRetried(result: RunDetail) {
    retried.set(result.id, result)
    runs().set(runSummarySchema.parse(result))

    return result
  }

  // The API answers before the worker delivers again, so the mock delivers by the next read.
  function retry(run: RunDetail) {
    deliveringAgain.add(run.id)

    return storeRetried(
      runDetailSchema.parse({
        ...run,
        status: 'received',
        failureStage: null,
        error: null,
        problem: null,
        waitingForTradingPartnerSince: null,
        steps: run.steps.map((step) =>
          step.stage === 'delivery'
            ? { ...step, status: 'pending', startedAt: null, finishedAt: null }
            : step,
        ),
      }),
    )
  }

  function deliverAgain(run: RunDetail) {
    const now = Date.now()

    deliveringAgain.delete(run.id)

    const delivered = runDetailSchema.parse({ ...run, status: 'delivered' })
    runs().set(runSummarySchema.parse(delivered))

    // A delivery that failed before the Interchange was built builds it on the Retry.
    return storeRetried(
      runDetailSchema.parse({
        ...delivered,
        interchange: run.interchange ?? interchangeOf(runs().groupOf(run.id)!),
        steps: run.steps.map((step) =>
          step.stage === 'delivery'
            ? {
                ...step,
                status: 'succeeded',
                startedAt: new Date(now).toISOString(),
                finishedAt: new Date(now + 840).toISOString(),
              }
            : step,
        ),
      }),
    )
  }

  function reprocess(run: RunDetail, version: MappingVersionSummary) {
    const replaced = runs().get(run.id)!

    const replacing: RunSummary = runSummarySchema.parse({
      ...replaced,
      id: crypto.randomUUID(),
      receivedAt: new Date().toISOString(),
      status: 'delivered',
      failureStage: null,
      problem: null,
    })

    chosenVersions.set(replacing.id, version)
    runs().reprocess({ replaced: replaced.id, replacing: replacing.id })
    runs().set(replacing)

    return detail(replacing.id)!
  }

  function interchange(id: string): Interchange | undefined {
    const group = runs().group(id)
    const generatedGroup = group && generate(group)
    const generatedInterchange = generatedGroup?.interchange

    if (!generatedGroup || !generatedInterchange) {
      return undefined
    }

    const first = group.messageOwners[0]!.run

    return interchangeSchema.parse({
      id: group.id,
      controlReference: generatedInterchange.controlReference,
      direction: directionOf(first),
      ...partiesOf(first),
      raw: generatedInterchange.raw,
      runs: group.allRunIds.map((runId) => ({
        ...runSummarySchema.parse(detail(runId)),
        messageReference: generatedGroup.messages.get(messageOwnerOf(group, runId))!.reference,
      })),
    })
  }

  function versionsOf(mappingId: string) {
    if (options.mappingVersions) {
      return options.mappingVersions.of(mappingId).map(toMappingVersionSummary)
    }

    const flows = new Map(
      runs()
        .all()
        .map((run) => [run.flow.id, run]),
    )

    return [...flows.values()]
      .map(mappingVersionsForFlow)
      .find((versions) => versions[0]?.mappingId === mappingId)
  }

  const versionListHandler = http.get<{ mappingId: string }>(
    `${apiUrl}${mappingVersionsEndpoint.path}`,
    ({ params }) => {
      const versions = versionsOf(params.mappingId)

      return versions
        ? HttpResponse.json(
            versions.map(mappingVersionEntries(problemSources.flows, options.tradingPartners)),
          )
        : problem(404, 'Not Found')
    },
  )

  return [
    http.get<{ id: string }>(`${apiUrl}${runEndpoint.path}`, ({ params }) => {
      const run = detail(params.id)

      return run ? HttpResponse.json(run) : problem(404, 'Not Found')
    }),

    http.post<{ id: string }>(`${apiUrl}${retryRunEndpoint.path}`, ({ params }) => {
      const run = detail(params.id)

      if (run === undefined) {
        return problem(404, 'Not Found')
      }

      // Before delivery there is no finished Document to send again, so the Defect is reprocessed.
      // A Retry at delivery keeps what it delivers and does not read the Document.
      if (run.problem?.reason === 'defect' && isReprocessable(run)) {
        if (run.documentDeletedAt !== null) {
          return problem(409, documentExpired)
        }

        reprocess(run, run.mappingVersion)

        return HttpResponse.json(detail(run.id))
      }

      if (run.status !== 'failed' || run.failureStage !== 'delivery') {
        return problem(409, 'Only a Run that failed at delivery can be retried.')
      }

      return HttpResponse.json(retry(run))
    }),

    http.post<{ id: string }>(`${apiUrl}${waitForTradingPartnerRunEndpoint.path}`, ({ params }) => {
      const run = detail(params.id)

      if (run === undefined) {
        return problem(404, 'Not Found')
      }

      if (run.problem?.whoFixes !== 'tradingPartner') {
        return problem(
          409,
          'Only a Run that the Trading Partner fixes can wait for the Trading Partner',
        )
      }

      if (run.replacedBy !== null) {
        return problem(409, 'A Run that another Run replaces cannot wait for the Trading Partner')
      }

      return HttpResponse.json(waitForTradingPartner(run))
    }),

    http.delete<{ id: string }>(
      `${apiUrl}${endWaitingForTradingPartnerRunEndpoint.path}`,
      ({ params }) => {
        const run = detail(params.id)

        if (run === undefined) {
          return problem(404, 'Not Found')
        }

        if (!waitingSince.delete(run.id)) {
          return problem(409, 'Only a Run that waits for the Trading Partner can end its wait')
        }

        return HttpResponse.json(detail(run.id))
      },
    ),

    http.post<{ id: string }>(
      `${apiUrl}${reprocessRunEndpoint.path}`,
      async ({ params, request }) => {
        const run = detail(params.id)

        if (run === undefined) {
          return problem(404, 'Not Found')
        }

        if (run.documentDeletedAt !== null) {
          return problem(409, documentExpired)
        }

        if (!isReprocessable(run)) {
          return problem(
            409,
            'Only a failed Run that is not replaced, failed before delivery and is not fixed by the Trading Partner can be reprocessed.',
          )
        }

        const body = reprocessRunBodySchema.safeParse(await request.json().catch(() => undefined))

        const version =
          body.success &&
          versionsOf(mappingVersionsForFlow(run)[0]!.mappingId)?.find(
            ({ id }) => id === body.data.mappingVersionId,
          )

        if (!version) {
          return problem(422, 'The Mapping Version does not belong to the Mapping of this Run.')
        }

        return HttpResponse.json(reprocess(run, version), { status: 201 })
      },
    ),

    http.get<{ id: string }>(`${apiUrl}${interchangeEndpoint.path}`, ({ params }) => {
      const result = interchange(params.id)

      return result ? HttpResponse.json(result) : problem(404, 'Not Found')
    }),
    // Within createHandlers the Mapping Version handlers serve this list from the shared store.
    ...(options.mappingVersions ? [] : [versionListHandler]),
  ]
}
