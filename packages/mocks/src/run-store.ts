import type { RunSummary } from '@edi-bridge/contracts'

export type RunStore = {
  all: () => readonly RunSummary[]
  newestFirst: () => readonly RunSummary[]
  get: (id: string) => RunSummary | undefined
  set: (run: RunSummary) => void
}

export function createRunStore(runs: ReadonlyArray<RunSummary>): RunStore {
  const byId = new Map(runs.map((run) => [run.id, run]))
  let all: RunSummary[] | undefined
  let newestFirst: RunSummary[] | undefined

  return {
    all: () => (all ??= [...byId.values()]),
    newestFirst: () =>
      (newestFirst ??= [...byId.values()].sort(
        (a, b) => Date.parse(b.receivedAt) - Date.parse(a.receivedAt),
      )),
    get: (id) => byId.get(id),
    set: (run) => {
      byId.set(run.id, run)
      all = undefined
      newestFirst = undefined
    },
  }
}

export function toRunStore(runs: ReadonlyArray<RunSummary> | RunStore) {
  return 'newestFirst' in runs ? runs : createRunStore(runs)
}
