import { directionOf, type RunSummary } from '@edi-bridge/contracts'

import { hash } from './hash'
import { failsBeforeInterchange } from './interchange'
import { statusOf } from './run-steps'
import { stableUuid } from './seed-id'

export type Reprocessed = { replaced: string; replacing: string }

export type MessageOwner = { runId: string; run: RunSummary }

// An inbound replacing Run reprocesses the Message of the Run it replaced, so it is among the
// allRunIds of the group but owns no Message.
export type RunGroup = {
  id: string
  controlReference: string
  formsInterchange: boolean
  messageOwners: MessageOwner[]
  allRunIds: string[]
}

export type RunStore = {
  all: () => readonly RunSummary[]
  unplaced: () => readonly RunSummary[]
  newestFirst: () => readonly RunSummary[]
  get: (id: string) => RunSummary | undefined
  set: (...runs: RunSummary[]) => RunSummary[]
  reprocess: (link: Reprocessed) => void
  replacedOf: (id: string) => string | undefined
  replacingOf: (id: string) => string | undefined
  groupOf: (runId: string) => RunGroup | undefined
  group: (id: string) => RunGroup | undefined
  groups: () => readonly RunGroup[]
  withBusinessReference: (businessReference: string) => readonly RunSummary[]
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

// The api writes an outbound Interchange in the delivery step, so only a validated Message has one.
function hasInterchange(firstRun: RunSummary) {
  return (
    directionOf(firstRun) === 'inbound' ||
    (statusOf(firstRun, 'validation') === 'succeeded' && !failsBeforeInterchange(firstRun))
  )
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

    // A Duplicate carries the control reference of the Interchange it repeats.
    const group = bundles.get(key) ?? {
      id,
      controlReference:
        (run.status === 'duplicate' && run.interchange?.controlReference) || controlReferenceOf(id),
      formsInterchange: false,
      messageOwners: [],
      allRunIds: [],
    }

    // An outbound replacing Run maps the same ERP Document again, into its own Interchange.
    group.messageOwners.push({
      runId: run.id,
      run: replaced ? { ...replaced, status: 'delivered', failureStage: null, problem: null } : run,
    })
    group.allRunIds.push(run.id)
    bundles.set(key, group)
    groups.set(group.id, group)
    groupOf.set(run.id, group)
  }

  for (const [run, replaced] of sharing) {
    const group = groupOf.get(replaced.id)

    if (group) {
      group.allRunIds.push(run.id)
      groupOf.set(run.id, group)
    }
  }

  for (const group of groups.values()) {
    group.formsInterchange = hasInterchange(group.messageOwners[0]!.run)
  }

  const placed = runs.map((run): RunSummary => {
    const group = groupOf.get(run.id)
    const replaced = byId.get(replaces.get(run.id) ?? '')

    return {
      ...run,
      businessReference: replaced ? replaced.businessReference : run.businessReference,
      interchange: group?.formsInterchange
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
  let byBusinessReference: Map<string, RunSummary[]> | undefined

  const placed = () => (placement ??= place([...byId.values()], replaces))

  function invalidate() {
    placement = undefined
    newestFirst = undefined
    groups = undefined
    byBusinessReference = undefined
  }

  function indexByBusinessReference() {
    const index = new Map<string, RunSummary[]>()

    for (const run of placed().runs) {
      if (run.businessReference === null) {
        continue
      }

      const runs = index.get(run.businessReference) ?? []
      runs.push(run)
      index.set(run.businessReference, runs)
    }

    return index
  }

  return {
    all: () => placed().runs,
    unplaced: () => [...byId.values()],
    newestFirst: () =>
      (newestFirst ??= placed()
        .runs.map((run) => ({ run, receivedAt: Date.parse(run.receivedAt) }))
        .sort((a, b) => b.receivedAt - a.receivedAt)
        .map(({ run }) => run)),
    get: (id) => placed().byId.get(id),
    set: (...changed) => {
      for (const run of changed) {
        byId.set(run.id, run)
      }

      invalidate()

      return changed.map((run) => placed().byId.get(run.id)!)
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
    withBusinessReference: (businessReference) =>
      (byBusinessReference ??= indexByBusinessReference()).get(businessReference) ?? [],
  }
}

export function toRunStore(
  runs: ReadonlyArray<RunSummary> | RunStore,
  reprocessed: ReadonlyArray<Reprocessed> = [],
) {
  return 'newestFirst' in runs ? runs : createRunStore(runs, reprocessed)
}
