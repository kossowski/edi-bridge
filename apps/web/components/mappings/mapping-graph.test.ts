import { describe, expect, it } from 'vitest'

import { messageTypeStructures, seedDocumentStructureOf } from '@edi-bridge/mocks'

import type { MappingTransform, TransformLink } from '@edi-bridge/contracts'

import {
  applyChange,
  canvasIssues,
  clampPosition,
  configureTransform,
  connect,
  freeSlot,
  type Graph,
  maxTransformX,
  newTransform,
  removeTransform,
  revertChange,
  transformNames,
} from './mapping-graph'
import { leafPaths, repeatingPaths } from './mapping-links'
import { documentTree, edifactTree } from './mapping-tree'

const sourceTree = documentTree(seedDocumentStructureOf.ORDERS)

const targetTree = edifactTree(messageTypeStructures.ORDERS, 'en')

const leaves = {
  leaves: { source: leafPaths(sourceTree), target: leafPaths(targetTree) },
  parts: { source: repeatingPaths(sourceTree), target: repeatingPaths(targetTree) },
}

const ids = {
  date: '00000000-0000-4000-8000-000000000001',
  join: '00000000-0000-4000-8000-000000000002',
  loop: '00000000-0000-4000-8000-000000000003',
}

const dateFormat = newTransform('dateFormat', ids.date, { x: 0, y: 0 })

const concatenate: MappingTransform = {
  id: ids.join,
  kind: 'concatenate',
  position: { x: 240, y: 0 },
  config: { inputCount: 3, separator: ' ' },
}

const loop: MappingTransform = {
  id: ids.loop,
  kind: 'loop',
  position: { x: 0, y: 200 },
  config: { counterStart: 1 },
}

const intoDate: TransformLink = {
  from: { kind: 'source', path: 'orderDate' },
  to: { kind: 'transform', transformId: ids.date, input: 'value' },
}

const dateIntoTarget: TransformLink = {
  from: { kind: 'transform', transformId: ids.date, output: 'value' },
  to: { kind: 'target', path: 'DTM+137/C507/2380' },
}

const joinParts: TransformLink[] = [1, 2, 3].map((part) => ({
  from: { kind: 'source', path: 'buyer.name' },
  to: { kind: 'transform', transformId: ids.join, input: `part${part}` },
}))

const graph: Graph = {
  links: [{ sourcePath: 'orderNumber', targetPath: 'BGM/1004' }],
  transforms: [dateFormat, concatenate, loop],
  transformLinks: [intoDate, dateIntoTarget, ...joinParts],
}

describe('connect', () => {
  it('links a source field straight into a free target as a plain link', () => {
    expect(
      connect(
        graph,
        leaves,
        { kind: 'source', path: 'note' },
        { kind: 'target', path: 'FTX+AAI/C108/4440' },
      ),
    ).toEqual({
      ok: true,
      change: { kind: 'addLink', link: { sourcePath: 'note', targetPath: 'FTX+AAI/C108/4440' } },
    })
  })

  it('links a transform output into another transform input', () => {
    const from = { kind: 'transform', transformId: ids.date, output: 'value' } as const
    const to = { kind: 'transform', transformId: ids.join, input: 'part1' } as const
    const free = { ...graph, transformLinks: [intoDate] }

    expect(connect(free, leaves, from, to)).toEqual({
      ok: true,
      change: { kind: 'addTransformLink', link: { from, to } },
    })
  })

  it('refuses a target a transform already fills and names the transform', () => {
    expect(
      connect(
        graph,
        leaves,
        { kind: 'source', path: 'orderDate' },
        { kind: 'target', path: 'DTM+137/C507/2380' },
      ),
    ).toEqual({ ok: false, reason: 'alreadyLinked', existing: dateIntoTarget.from })
  })

  it('refuses a target a plain link already fills', () => {
    expect(
      connect(
        graph,
        leaves,
        { kind: 'transform', transformId: ids.join, output: 'value' },
        { kind: 'target', path: 'BGM/1004' },
      ),
    ).toEqual({
      ok: false,
      reason: 'alreadyLinked',
      existing: { kind: 'source', path: 'orderNumber' },
    })
  })

  it('refuses a second link into an input', () => {
    expect(connect(graph, leaves, { kind: 'source', path: 'note' }, intoDate.to)).toEqual({
      ok: false,
      reason: 'inputTaken',
      existing: intoDate.from,
    })
  })

  it('refuses a link that would make transforms feed each other in a circle', () => {
    const joinIntoDate = {
      ...graph,
      transformLinks: [
        ...joinParts.slice(1),
        {
          from: { kind: 'transform', transformId: ids.join, output: 'value' },
          to: { kind: 'transform', transformId: ids.date, input: 'value' },
        } as const,
      ],
    }

    expect(
      connect(
        joinIntoDate,
        leaves,
        { kind: 'transform', transformId: ids.date, output: 'value' },
        { kind: 'transform', transformId: ids.join, input: 'part1' },
      ),
    ).toEqual({ ok: false, reason: 'circle' })
    expect(
      connect(
        { ...graph, transformLinks: [] },
        leaves,
        { kind: 'transform', transformId: ids.date, output: 'value' },
        { kind: 'transform', transformId: ids.date, input: 'value' },
      ),
    ).toEqual({ ok: false, reason: 'circle' })
  })

  it('refuses parts and ports a transform does not have, and names the refused end', () => {
    expect(
      connect(
        graph,
        leaves,
        { kind: 'source', path: 'buyer' },
        { kind: 'target', path: 'FTX+AAI/C108/4440' },
      ),
    ).toEqual({ ok: false, reason: 'notLinkable', end: 'from' })
    expect(
      connect(
        graph,
        leaves,
        { kind: 'source', path: 'note' },
        { kind: 'transform', transformId: ids.join, input: 'part4' },
      ),
    ).toEqual({ ok: false, reason: 'notLinkable', end: 'to' })
  })

  it('links a repeating source part into a loop and the loop into a repeating target part', () => {
    const items = { kind: 'transform', transformId: ids.loop, input: 'items' } as const
    const itemsOut = { kind: 'transform', transformId: ids.loop, output: 'items' } as const

    expect(connect(graph, leaves, { kind: 'source', path: 'lines[]' }, items)).toEqual({
      ok: true,
      change: {
        kind: 'addTransformLink',
        link: { from: { kind: 'source', path: 'lines[]' }, to: items },
      },
    })
    expect(connect(graph, leaves, itemsOut, { kind: 'target', path: 'SG25' })).toEqual({
      ok: true,
      change: {
        kind: 'addTransformLink',
        link: { from: itemsOut, to: { kind: 'target', path: 'SG25' } },
      },
    })
  })

  it('links a repeating part only through a loop', () => {
    expect(
      connect(
        graph,
        leaves,
        { kind: 'source', path: 'lines[]' },
        { kind: 'target', path: 'FTX+AAI/C108/4440' },
      ),
    ).toEqual({ ok: false, reason: 'needsLoop', end: 'from' })
    expect(
      connect(
        graph,
        leaves,
        { kind: 'transform', transformId: ids.date, output: 'value' },
        { kind: 'target', path: 'SG25' },
      ),
    ).toEqual({ ok: false, reason: 'needsLoop', end: 'to' })
  })

  it('says which end of a link takes the whole repeating part of a loop', () => {
    expect(
      connect(
        graph,
        leaves,
        { kind: 'source', path: 'note' },
        { kind: 'transform', transformId: ids.loop, input: 'items' },
      ),
    ).toEqual({ ok: false, reason: 'needsPart', end: 'to' })
    expect(
      connect(
        graph,
        leaves,
        { kind: 'transform', transformId: ids.loop, output: 'items' },
        { kind: 'target', path: 'FTX+AAI/C108/4440' },
      ),
    ).toEqual({ ok: false, reason: 'needsPart', end: 'from' })
  })
})

describe('applyChange and revertChange', () => {
  it('removes a transform together with its links', () => {
    const change = removeTransform(graph, ids.date)!

    expect(change).toEqual({
      kind: 'removeTransform',
      transform: dateFormat,
      transformLinks: [intoDate, dateIntoTarget],
    })

    const removed = applyChange(graph, change)

    expect(removed.transforms).toEqual([concatenate, loop])
    expect(removed.transformLinks).toEqual(joinParts)
    expect(revertChange(removed, change)).toEqual({
      links: graph.links,
      transforms: [concatenate, loop, dateFormat],
      transformLinks: [...joinParts, intoDate, dateIntoTarget],
    })
  })

  it('takes back a failed change and keeps the changes made after it', () => {
    const added = newTransform('constant', '00000000-0000-4000-8000-000000000009', { x: 0, y: 400 })
    const later = { sourcePath: 'note', targetPath: 'FTX+AAI/C108/4440' }

    const afterBoth = applyChange(applyChange(graph, { kind: 'addTransform', transform: added }), {
      kind: 'addLink',
      link: later,
    })

    expect(revertChange(afterBoth, { kind: 'addTransform', transform: added })).toEqual({
      ...graph,
      links: [...graph.links, later],
    })
  })

  it('brings back a removed link only where it still fits', () => {
    const removed = applyChange(graph, { kind: 'removeTransformLink', link: dateIntoTarget })

    const taken = applyChange(removed, {
      kind: 'addLink',
      link: { sourcePath: 'orderDate', targetPath: 'DTM+137/C507/2380' },
    })

    expect(revertChange(removed, { kind: 'removeTransformLink', link: dateIntoTarget })).toEqual({
      ...graph,
      transformLinks: [intoDate, ...joinParts, dateIntoTarget],
    })
    expect(revertChange(taken, { kind: 'removeTransformLink', link: dateIntoTarget })).toEqual(
      taken,
    )
  })

  it('drops the links into the parts a lower input count removes, and brings them back', () => {
    const change = configureTransform(graph, concatenate, { inputCount: 2, separator: ' ' })

    expect(change).toMatchObject({ kind: 'configureTransform', dropped: [joinParts[2]] })

    const configured = applyChange(graph, change)

    expect(configured.transformLinks).toEqual([
      intoDate,
      dateIntoTarget,
      joinParts[0],
      joinParts[1],
    ])
    expect(revertChange(configured, change)).toEqual(graph)
  })

  it('keeps a later move when a configuration fails', () => {
    const change = configureTransform(graph, concatenate, { inputCount: 3, separator: '-' })
    const configured = applyChange(graph, change)
    const moved = { ...concatenate, position: { x: 0, y: 600 } }

    const afterMove = {
      ...configured,
      transforms: configured.transforms.map((transform) =>
        transform.id === ids.join ? { ...transform, position: moved.position } : transform,
      ),
    }

    expect(revertChange(afterMove, change).transforms).toContainEqual(moved)
  })
})

describe('placing', () => {
  it('keeps transforms between the trees', () => {
    expect(clampPosition({ x: -30, y: -5 })).toEqual({ x: 0, y: 0 })
    expect(clampPosition({ x: 900, y: 120.4 })).toEqual({ x: maxTransformX, y: 120 })
  })

  it('finds the first free spot at or below the visible top', () => {
    const taken = [
      { x: 0, y: 0, height: 120 },
      { x: 240, y: 0, height: 120 },
    ]

    expect(freeSlot([], 50, 100)).toEqual({ x: 0, y: 50 })
    expect(freeSlot(taken, 0, 100)).toEqual({ x: 0, y: 140 })
    expect(freeSlot([taken[0]!], 0, 100)).toEqual({ x: 240, y: 0 })
  })

  it('numbers transforms of one kind in the order they were placed', () => {
    const second = newTransform('dateFormat', '00000000-0000-4000-8000-000000000008', {
      x: 0,
      y: 0,
    })

    const names = transformNames([dateFormat, concatenate, second])

    expect(names.get(ids.date)).toEqual({ kind: 'dateFormat', number: 1 })
    expect(names.get(ids.join)).toEqual({ kind: 'concatenate', number: 1 })
    expect(names.get(second.id)).toEqual({ kind: 'dateFormat', number: 2 })
  })
})

describe('canvasIssues', () => {
  const tableId = '00000008-0000-4000-8000-000000000001'

  const lookup: MappingTransform = {
    id: '00000000-0000-4000-8000-000000000009',
    kind: 'lookupTable',
    position: { x: 0, y: 0 },
    config: { lookupTableId: tableId, fallback: 'keepValue' },
  }

  const linked = {
    transforms: [lookup],
    transformLinks: [
      {
        from: { kind: 'source', path: 'note' },
        to: { kind: 'transform', transformId: lookup.id, input: 'value' },
      } as const,
    ],
  }

  it('reports a chosen Lookup Table that is no longer in the list', () => {
    expect(canvasIssues(linked, [])).toEqual({
      [lookup.id]: [{ field: 'lookupTableId', code: 'unknownLookupTable' }],
    })
  })

  it('reports nothing about the Lookup Table while the list is unknown or holds it', () => {
    expect(canvasIssues(linked, undefined)).toEqual({ [lookup.id]: [] })
    expect(canvasIssues(linked, [{ id: tableId }])).toEqual({ [lookup.id]: [] })
  })
})
