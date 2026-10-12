import { directionOf, type RunSummary } from '@edi-bridge/contracts'

import { hash } from './hash'
import { statusOf } from './run-steps'
import { stableUuid } from './seed-id'

export type Reprocessed = { replaced: string; replacing: string }

export type InterchangeMember = { runId: string; run: RunSummary }

export type RunGroup = {
  id: string
  controlReference: string
  hasInterchange: boolean
  members: InterchangeMember[]
  runIds: string[]
}

export type RunStore = {
  all: () => readonly RunSummary[]
  newestFirst: () => readonly RunSummary[]
  get: (id: string) => RunSummary | undefined
  set: (run: RunSummary) => void
  reprocess: (link: Reprocessed) => void
  replacedOf: (id: string) => string | undefined
  replacingOf: (id: string) => string | undefined
  groupOf: (runId: string) => RunGroup | undefined
  group: (id: string) => RunGroup | undefined
  groups: () => readonly RunGroup[]
}

// The first Run of an Interchange names it: Run ids come from a fixed seed, while the seeded
// receipt times move with the page load.
export function interchangeIdOf(firstRun: Pick<RunSummary, 'id'>) {
  return stableUuid(`interchange:${firstRun.id}`)
}

export function controlReferenceOf(interchangeId: string) {
  return String((hash(`control-reference:${interchangeId}`) % 99_999_999) + 1)
}

export function bundleKeyOf(
  run: Pick<RunSummary, 'id' | 'messageType' | 'tradingPartner' | 'flow' | 'receivedAt'>,
) {
  return directionOf(run) === 'inbound'
    ? `${run.tradingPartner.id}|${run.flow.id}|${run.receivedAt}`
    : run.id
}

export function hasInterchange(firstRun: Parameters<typeof statusOf>[0]) {
  return directionOf(firstRun) === 'inbound' || statusOf(firstRun, 'mapping') === 'succeeded'
}

type Placement = {
  runs: RunSummary[]
  byId: Map<string, RunSummary>
  groupOf: Map<string, RunGroup>
  groups: Map<string, RunGroup>
}

function place(runs: ReadonlyArray<RunSummary>, replaces: ReadonlyMap<string, string>): Placement {
  const byId = new Map(runs.map((run) => [run.id, run]))
  const bundles = new Map<string, RunGroup>()
  const groups = new Map<string, RunGroup>()
  const groupOf = new Map<string, RunGroup>()
  const sharing: Array<[RunSummary, RunSummary]> = []

  for (const run of runs) {
    const replaced = byId.get(replaces.get(run.id) ?? '')

    // An inbound replacing Run reprocesses the Message of the Run it replaced.
    if (replaced && directionOf(run) === 'inbound') {
      sharing.push([run, replaced])
      continue
    }

    const key = bundleKeyOf(run)
    const id = interchangeIdOf(run)

    const group = bundles.get(key) ?? {
      id,
      controlReference: controlReferenceOf(id),
      hasInterchange: false,
      members: [],
      runIds: [],
    }

    // An outbound replacing Run maps the same ERP Document again, into its own Interchange.
    group.members.push({
      runId: run.id,
      run: replaced ? { ...replaced, status: 'delivered', failureStage: null } : run,
    })
    group.runIds.push(run.id)
    bundles.set(key, group)
    groups.set(group.id, group)
    groupOf.set(run.id, group)
  }

  for (const [run, replaced] of sharing) {
    const group = groupOf.get(replaced.id)

    if (group) {
      group.runIds.push(run.id)
      groupOf.set(run.id, group)
    }
  }

  for (const group of groups.values()) {
    group.hasInterchange = hasInterchange(group.members[0]!.run)
  }

  const placed = runs.map((run): RunSummary => {
    const group = groupOf.get(run.id)
    const replaced = byId.get(replaces.get(run.id) ?? '')

    return {
      ...run,
      businessReference: replaced ? replaced.businessReference : run.businessReference,
      interchange: group?.hasInterchange
        ? { id: group.id, controlReference: group.controlReference }
        : null,
    }
  })

  return { runs: placed, byId: new Map(placed.map((run) => [run.id, run])), groupOf, groups }
}

export function createRunStore(
  runs: ReadonlyArray<RunSummary>,
  reprocessed: ReadonlyArray<Reprocessed> = [],
): RunStore {
  const byId = new Map(runs.map((run) => [run.id, run]))
  const replaces = new Map(reprocessed.map(({ replaced, replacing }) => [replacing, replaced]))
  const replacedBy = new Map(reprocessed.map(({ replaced, replacing }) => [replaced, replacing]))
  let placement: Placement | undefined
  let newestFirst: RunSummary[] | undefined
  let groups: RunGroup[] | undefined

  const placed = () => (placement ??= place([...byId.values()], replaces))

  function invalidate() {
    placement = undefined
    newestFirst = undefined
    groups = undefined
  }

  return {
    all: () => placed().runs,
    newestFirst: () =>
      (newestFirst ??= placed().runs.toSorted(
        (a, b) => Date.parse(b.receivedAt) - Date.parse(a.receivedAt),
      )),
    get: (id) => placed().byId.get(id),
    set: (run) => {
      byId.set(run.id, run)
      invalidate()
    },
    reprocess: ({ replaced, replacing }) => {
      if (replaces.get(replacing) === replaced) {
        return
      }

      replaces.set(replacing, replaced)
      replacedBy.set(replaced, replacing)
      invalidate()
    },
    replacedOf: (id) => replaces.get(id),
    replacingOf: (id) => replacedBy.get(id),
    groupOf: (runId) => placed().groupOf.get(runId),
    group: (id) => placed().groups.get(id),
    groups: () => (groups ??= [...placed().groups.values()]),
  }
}

export function toRunStore(
  runs: ReadonlyArray<RunSummary> | RunStore,
  reprocessed: ReadonlyArray<Reprocessed> = [],
) {
  if (!('newestFirst' in runs)) {
    return createRunStore(runs, reprocessed)
  }

  for (const link of reprocessed) {
    runs.reprocess(link)
  }

  return runs
}
