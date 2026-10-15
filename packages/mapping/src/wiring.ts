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

export type Graph = {
  lookupTables: LookupTables
  transforms: ReadonlyMap<string, MappingTransform>
  feeding: ReadonlyMap<string, LinkStart>
  valid: ReadonlySet<string>
  targets: ReadonlyArray<TransformTarget>
}

type PartialLoop = Omit<Loop, 'sourcePart'> & { sourcePart?: string }

export type Wiring = {
  graph: Graph
  loops: ReadonlyMap<string, Loop>
  loopTargets: ReadonlyArray<string>
}

export function wiringOf(
  version: Pick<MappingVersion, 'transforms' | 'transformLinks'>,
  lookupTables: ReadonlyMap<string, ReadonlyArray<LookupTableEntry>> = new Map(),
): Wiring {
  const { transforms, transformLinks } = version
  const partials = new Map<string, PartialLoop>()

  for (const transform of transforms) {
    if (transform.kind === 'loop') {
      partials.set(transform.id, {
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
      const partial = partials.get(to.transformId)

      if (partial && to.input === 'items' && from.kind === 'source') {
        partial.sourcePart = from.path
      }

      feeding.set(`${to.transformId}/${to.input}`, from)
      continue
    }

    if (from.kind === 'transform' && from.output === 'items') {
      loopTargets.push(to.path)
      partials.get(from.transformId)?.targetParts.push(to.path)
      continue
    }

    if (from.kind === 'transform') {
      targets.push({ path: to.path, from })
    }
  }

  const loops = new Map<string, Loop>()

  for (const { sourcePart, ...partial } of partials.values()) {
    if (sourcePart !== undefined) {
      const loop = { sourcePart, ...partial }

      for (const targetPart of loop.targetParts) {
        loops.set(targetPart, loop)
      }
    }
  }

  const issues = transformIssues(version)

  const graph: Graph = {
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
