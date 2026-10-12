import { http, HttpResponse } from 'msw'

import {
  directionOf,
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
} from '@edi-bridge/contracts'

import { mappingVersionsForFlow } from './flow'
import {
  type GeneratedInterchange,
  type GeneratedMessage,
  generateMessage,
  partiesOf,
  serializeInterchange,
} from './interchange'
import { type MappingVersionStore, toMappingVersionSummary } from './mapping-version'
import { seedRuns } from './run'
import { stagesOf, statusOf, stepStatuses } from './run-steps'
import {
  bundleKeyOf,
  type Reprocessed,
  type RunGroup,
  type RunStore,
  toRunStore,
} from './run-store'
import { seededFaker } from './seeded-faker'

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

function pinnedVersion(run: RunSummary) {
  const versions = mappingVersionsForFlow(run)
  const receivedAt = Date.parse(run.receivedAt)

  return (
    versions.find(({ publishedAt }) => Date.parse(publishedAt) <= receivedAt) ?? versions.at(-1)!
  )
}

type GeneratedGroup = {
  messages: ReadonlyMap<string, GeneratedMessage>
  interchange: (GeneratedInterchange & { controlReference: string }) | null
}

// A Run Store already holds its reprocessing links.
export type RunDetailOptions = (
  | { runs?: ReadonlyArray<RunSummary>; reprocessed?: ReadonlyArray<Reprocessed> }
  | { runs: RunStore; reprocessed?: never }
) & { mappingVersions?: MappingVersionStore }

export function seedReprocessed(runs: ReadonlyArray<RunSummary> = seedRuns()): Reprocessed[] {
  const bundleSizes = Map.groupBy(runs, bundleKeyOf)

  return (['inbound', 'outbound'] as const).flatMap((direction) => {
    const replaced = runs.find(
      (run) =>
        directionOf(run) === direction && run.status === 'failed' && run.failureStage === 'mapping',
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

function problem(status: number, message: string) {
  return HttpResponse.json({ message }, { status })
}

export function runDetailHandlers(apiUrl: string, options: RunDetailOptions = {}) {
  let store: RunStore | undefined
  const generated = new WeakMap<RunGroup, GeneratedGroup>()
  const chosenVersions = new Map<string, MappingVersionSummary>()
  const retried = new Map<string, RunDetail>()

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
      return retriedDetail
    }

    const replacing = runs().replacingOf(id)
    const replaced = runs().replacedOf(id)
    const group = runs().groupOf(id)!
    const { messages, interchange } = generate(group)
    const messageOwner = messageOwnerOf(group, id)
    const message = messages.get(messageOwner)!
    const direction = directionOf(run)

    return runDetailSchema.parse({
      ...run,
      steps: timeSteps(run),
      error:
        run.status === 'failed' && message.error
          ? { ...message.error, position: interchange?.positions.get(messageOwner) ?? null }
          : null,
      interchange: interchange && {
        id: group.id,
        controlReference: interchange.controlReference,
        raw: interchange.raw,
      },
      message:
        statusOf(run, direction === 'inbound' ? 'parse' : 'mapping') === 'succeeded'
          ? message.parsed
          : null,
      mappingVersion: ['pending', 'skipped'].includes(statusOf(run, 'mapping')!)
        ? null
        : (chosenVersions.get(id) ?? pinnedVersion(run)),
      replaces: replaced ? { id: replaced } : null,
      replacedBy: replacing ? { id: replacing } : null,
    })
  }

  function retry(run: RunDetail) {
    const now = Date.now()

    const result = runDetailSchema.parse({
      ...run,
      status: 'delivered',
      failureStage: null,
      error: null,
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
    })

    retried.set(run.id, result)
    runs().set(runSummarySchema.parse(result))

    return result
  }

  function reprocess(run: RunDetail, version: MappingVersionSummary) {
    const replaced = runs().get(run.id)!

    const replacing: RunSummary = runSummarySchema.parse({
      ...replaced,
      id: crypto.randomUUID(),
      receivedAt: new Date().toISOString(),
      status: 'delivered',
      failureStage: null,
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

      return versions ? HttpResponse.json(versions) : problem(404, 'Not Found')
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

      if (run.status !== 'failed' || run.failureStage !== 'delivery') {
        return problem(409, 'Only a Run that failed at delivery can be retried.')
      }

      return HttpResponse.json(retry(run))
    }),

    http.post<{ id: string }>(
      `${apiUrl}${reprocessRunEndpoint.path}`,
      async ({ params, request }) => {
        const run = detail(params.id)

        if (run === undefined) {
          return problem(404, 'Not Found')
        }

        if (run.status !== 'failed' || run.failureStage !== 'mapping' || run.replacedBy) {
          return problem(
            409,
            'Only a Run that failed at mapping and is not replaced can be reprocessed.',
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
