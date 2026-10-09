import { http, HttpResponse } from 'msw'

import {
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
  type RunStepStatus,
  type RunSummary,
  runSummarySchema,
} from '@edi-bridge/contracts'

import { directionOf } from './flow'
import {
  type GeneratedInterchange,
  type GeneratedMessage,
  generateMessage,
  partiesOf,
  serializeInterchange,
} from './interchange'
import { mappingVersionsForFlow } from './mapping-version'
import { seedRuns } from './run'
import { stableUuid } from './seed-id'
import { seededFaker } from './seeded-faker'

const stepDurations: Readonly<Record<RunStepStage, readonly [number, number]>> = {
  receipt: [20, 200],
  parse: [5, 80],
  validation: [5, 120],
  mapping: [20, 600],
  delivery: [100, 3000],
}

const deliveryTimeout = 30_000

function stagesOf(run: Pick<RunSummary, 'messageType'>): RunStepStage[] {
  return directionOf(run) === 'outbound'
    ? ['receipt', 'mapping', 'validation', 'delivery']
    : ['receipt', 'parse', 'validation', 'mapping', 'delivery']
}

function stepStatuses(run: RunSummary): RunStepStatus[] {
  const stages = stagesOf(run)

  switch (run.status) {
    case 'delivered': {
      return stages.map(() => 'succeeded')
    }

    case 'failed': {
      const failed = stages.indexOf(run.failureStage)

      return stages.map((_, index) =>
        index < failed ? 'succeeded' : index === failed ? 'failed' : 'skipped',
      )
    }

    case 'processing': {
      const running = seededFaker(`steps:${run.id}`).number.int({ min: 1, max: stages.length - 1 })

      return stages.map((_, index) =>
        index < running ? 'succeeded' : index === running ? 'running' : 'pending',
      )
    }

    case 'received': {
      return stages.map((_, index) => (index === 0 ? 'succeeded' : 'pending'))
    }

    case 'duplicate': {
      // An inbound Duplicate is detected from the UNB envelope, so it gets through parsing first.
      const detectedAt = directionOf(run) === 'inbound' ? 1 : 0

      return stages.map((_, index) => (index <= detectedAt ? 'succeeded' : 'skipped'))
    }
  }
}

function statusOf(run: RunSummary, stage: RunStepStage) {
  return stepStatuses(run)[stagesOf(run).indexOf(stage)]
}

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

type Member = { runId: string; run: RunSummary }

type Group = { id: string; members: Member[] }

type GeneratedGroup = {
  messages: ReadonlyMap<string, GeneratedMessage>
  interchange: (GeneratedInterchange & { controlReference: string }) | null
}

type Reprocessed = { replaced: string; replacing: string }

export type RunDetailOptions = {
  runs?: ReadonlyArray<RunSummary>
  reprocessed?: ReadonlyArray<Reprocessed>
}

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

// The first Run of an Interchange names it: Run ids come from a fixed seed, while the seeded
// receipt times move with the page load.
export function interchangeIdOf(firstRun: RunSummary) {
  return stableUuid(`interchange:${firstRun.id}`)
}

function bundleKeyOf(run: RunSummary) {
  return directionOf(run) === 'inbound'
    ? `${run.tradingPartner.id}|${run.flow.id}|${run.receivedAt}`
    : run.id
}

function problem(status: number, message: string) {
  return HttpResponse.json({ message }, { status })
}

export function runDetailHandlers(apiUrl: string, options: RunDetailOptions = {}) {
  const runs = new Map<string, RunSummary>()
  const groups = new Map<string, Group>()
  const bundles = new Map<string, Group>()
  const groupOf = new Map<string, Group>()
  const generated = new Map<string, GeneratedGroup>()
  const sourceOf = new Map<string, string>()
  const replacedBy = new Map<string, string>()
  const chosenVersions = new Map<string, MappingVersionSummary>()
  const retried = new Map<string, RunDetail>()
  let indexed = false

  function join(run: RunSummary, member: Member) {
    const key = bundleKeyOf(run)
    const group = bundles.get(key) ?? { id: interchangeIdOf(run), members: [] }
    group.members.push(member)
    bundles.set(key, group)
    groups.set(group.id, group)
    groupOf.set(member.runId, group)
  }

  function add(run: RunSummary, replaced?: RunSummary) {
    runs.set(run.id, run)

    if (replaced === undefined) {
      join(run, { runId: run.id, run })
    } else if (directionOf(run) === 'outbound') {
      // The replacing Run maps the same ERP Document again, so it produces its own Interchange.
      join(run, {
        runId: run.id,
        run: { ...replaced, status: 'delivered', failureStage: null },
      })
    } else {
      groupOf.set(run.id, groupOf.get(replaced.id)!)
    }
  }

  function ensureIndexed() {
    if (indexed) {
      return
    }

    indexed = true
    const all = options.runs ?? seedRuns()

    for (const { replaced, replacing } of options.reprocessed ?? []) {
      sourceOf.set(replacing, replaced)
      replacedBy.set(replaced, replacing)
    }

    for (const run of all) {
      if (!sourceOf.has(run.id)) {
        add(run)
      }
    }

    for (const run of all) {
      const replaced = runs.get(sourceOf.get(run.id) ?? '')

      if (replaced) {
        add(run, replaced)
      }
    }
  }

  function generate(group: Group): GeneratedGroup {
    const cached = generated.get(group.id)

    if (cached) {
      return cached
    }

    const first = group.members[0]!.run

    const messages = new Map(
      group.members.map(({ runId, run }, position) => [
        runId,
        generateMessage(run, String(position + 1)),
      ]),
    )

    const controlReference = String(seededFaker(group.id).number.int({ min: 1, max: 99_999_999 }))

    const result: GeneratedGroup = {
      messages,
      interchange:
        directionOf(first) === 'inbound' || statusOf(first, 'mapping') === 'succeeded'
          ? {
              controlReference,
              ...serializeInterchange({
                controlReference,
                parties: partiesOf(first),
                preparedAt: first.receivedAt,
                messages: group.members.map(({ runId }) => ({
                  runId,
                  message: messages.get(runId)!,
                })),
              }),
            }
          : null,
    }

    generated.set(group.id, result)

    return result
  }

  // An inbound replacing Run reprocesses the Message of the Run it replaced.
  function messageOwnerOf(runId: string) {
    return groupOf.get(runId)!.members.some((member) => member.runId === runId)
      ? runId
      : sourceOf.get(runId)!
  }

  function detail(id: string): RunDetail | undefined {
    ensureIndexed()
    const run = runs.get(id)

    if (run === undefined) {
      return undefined
    }

    const replacing = replacedBy.get(id)
    const retriedDetail = retried.get(id)

    if (retriedDetail) {
      return retriedDetail
    }

    const group = groupOf.get(id)!
    const { messages, interchange } = generate(group)
    const messageOwner = messageOwnerOf(id)
    const message = messages.get(messageOwner)!
    const direction = directionOf(run)

    return runDetailSchema.parse({
      ...run,
      direction,
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
      replaces: sourceOf.has(id) ? { id: sourceOf.get(id) } : null,
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

    return result
  }

  function reprocess(run: RunDetail, version: MappingVersionSummary) {
    const replaced = runs.get(run.id)!

    const replacing: RunSummary = runSummarySchema.parse({
      ...replaced,
      id: crypto.randomUUID(),
      receivedAt: new Date().toISOString(),
      status: 'delivered',
      failureStage: null,
    })

    sourceOf.set(replacing.id, replaced.id)
    replacedBy.set(replaced.id, replacing.id)
    chosenVersions.set(replacing.id, version)
    add(replacing, replaced)

    return detail(replacing.id)!
  }

  function interchange(id: string): Interchange | undefined {
    ensureIndexed()
    const group = groups.get(id)
    const generatedGroup = group && generate(group)
    const generatedInterchange = generatedGroup?.interchange

    if (!generatedGroup || !generatedInterchange) {
      return undefined
    }

    const first = group.members[0]!.run

    const produced = [...groupOf].flatMap(([runId, runGroup]) =>
      runGroup === group ? [runId] : [],
    )

    return interchangeSchema.parse({
      id: group.id,
      controlReference: generatedInterchange.controlReference,
      direction: directionOf(first),
      ...partiesOf(first),
      raw: generatedInterchange.raw,
      runs: produced.map((runId) => ({
        ...runSummarySchema.parse(detail(runId)),
        messageReference: generatedGroup.messages.get(messageOwnerOf(runId))!.reference,
      })),
    })
  }

  function versionsOf(mappingId: string) {
    ensureIndexed()
    const flows = new Map([...runs.values()].map((run) => [run.flow.id, run]))

    return [...flows.values()]
      .map(mappingVersionsForFlow)
      .find((versions) => versions[0]?.mappingId === mappingId)
  }

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
          mappingVersionsForFlow(run).find(({ id }) => id === body.data.mappingVersionId)

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

    http.get<{ mappingId: string }>(`${apiUrl}${mappingVersionsEndpoint.path}`, ({ params }) => {
      const versions = versionsOf(params.mappingId)

      return versions ? HttpResponse.json(versions) : problem(404, 'Not Found')
    }),
  ]
}
