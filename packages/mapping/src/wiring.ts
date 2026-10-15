import {
  type LinkStart,
  type LookupTableEntry,
  type MappingTransform,
  type MappingVersion,
  transformIssues,
} from '@edi-bridge/contracts'

export type Loop = {
  id: string
  sourcePart: string
  targetParts: string[]
  counterStart: number
}

export type TransformTarget = { path: string; from: LinkStart & { kind: 'transform' } }

export type LookupTables = ReadonlyMap<string, ReadonlyMap<string, string>>

export type Expressions = ReadonlyMap<string, string>

export type Graph = {
  expressions: Expressions
  lookupTables: LookupTables
  transforms: ReadonlyMap<string, MappingTransform>
  feeding: ReadonlyMap<string, LinkStart>
  valid: ReadonlySet<string>
  targets: ReadonlyArray<TransformTarget>
}

type LoopDraft = Omit<Loop, 'sourcePart'> & { sourcePart?: string }

export type Wiring = {
  graph: Omit<Graph, 'expressions'>
  loops: ReadonlyMap<string, Loop>
  loopTargets: ReadonlyArray<string>
}

export function wiringOf(
  version: Pick<MappingVersion, 'transforms' | 'transformLinks'>,
  lookupTables: ReadonlyMap<string, ReadonlyArray<LookupTableEntry>> = new Map(),
): Wiring {
  const { transforms, transformLinks } = version
  const drafts = new Map<string, LoopDraft>()

  for (const transform of transforms) {
    if (transform.kind === 'loop') {
      drafts.set(transform.id, {
        id: transform.id,
        targetParts: [],
        counterStart: transform.config.counterStart,
      })
    }
  }

  const feeding = new Map<string, LinkStart>()
  const targets: TransformTarget[] = []
  const loopTargets: string[] = []

  for (const { from, to } of transformLinks) {
    if (to.kind === 'transform') {
      const draft = drafts.get(to.transformId)

      if (draft && to.input === 'items' && from.kind === 'source') {
        draft.sourcePart = from.path
      }

      feeding.set(`${to.transformId}/${to.input}`, from)
      continue
    }

    if (from.kind === 'transform' && from.output === 'items') {
      loopTargets.push(to.path)
      drafts.get(from.transformId)?.targetParts.push(to.path)
      continue
    }

    if (from.kind === 'transform') {
      targets.push({ path: to.path, from })
    }
  }

  const loops = new Map<string, Loop>()

  for (const { sourcePart, ...draft } of drafts.values()) {
    if (sourcePart !== undefined) {
      const loop = { sourcePart, ...draft }

      for (const targetPart of loop.targetParts) {
        loops.set(targetPart, loop)
      }
    }
  }

  const issues = transformIssues(version)

  const graph: Wiring['graph'] = {
    lookupTables: new Map(
      [...lookupTables].map(([id, entries]) => [
        id,
        new Map(entries.map(({ sourceCode, targetCode }) => [sourceCode, targetCode])),
      ]),
    ),
    transforms: new Map(transforms.map((transform) => [transform.id, transform])),
    feeding,
    valid: new Set(transforms.flatMap(({ id }) => (issues[id]?.length ? [] : [id]))),
    targets,
  }

  return { graph, loops, loopTargets }
}
