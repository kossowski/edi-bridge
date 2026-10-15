import {
  type DocumentStructureNode,
  type EdifactSegment,
  type EdifactStructureNode,
  type JsonContent,
  type MessageType,
  messageTypeStructures,
  type OutputEntry,
} from '@edi-bridge/contracts'

import type { Message, Segment } from '@edi-bridge/edifact'

import { valueSchema } from './evaluation'
import { jsonListSchema, jsonObjectSchema } from './json'
import { type Occurrences, placeMessage } from './placement'

const repeated = (maxRepeat: number, at: ReadonlyArray<number>, index: number) =>
  maxRepeat > 1 ? [...at, index] : [...at]

function segmentEntries(node: EdifactSegment, segment: Segment, at: number[]): OutputEntry[] {
  return node.children
    .flatMap((child, index) => {
      const element = segment.elements[index] ?? []

      return child.kind === 'element'
        ? [{ path: child.path, at, value: element[0] }]
        : child.children.map(({ path }, position) => ({ path, at, value: element[position] }))
    })
    .flatMap(({ value, ...entry }) =>
      value === undefined || value === '' ? [] : [{ ...entry, value }],
    )
}

function occurrenceEntries(
  nodes: ReadonlyArray<EdifactStructureNode>,
  occurrences: Occurrences,
  at: ReadonlyArray<number>,
): OutputEntry[] {
  return nodes.flatMap((node) =>
    node.kind === 'segment'
      ? (occurrences.segments.get(node.path) ?? []).flatMap((segment, index) =>
          segmentEntries(node, segment, repeated(node.maxRepeat, at, index)),
        )
      : (occurrences.groups.get(node.path) ?? []).flatMap((repetition, index) =>
          occurrenceEntries(node.children, repetition, repeated(node.maxRepeat, at, index)),
        ),
  )
}

export function messageEntries(messageType: MessageType, message: Message): OutputEntry[] {
  const { children } = messageTypeStructures[messageType]

  return occurrenceEntries(children, placeMessage(children, message), [])
}

function scalarEntries(path: string, content: JsonContent | undefined, at: number[]) {
  const scalar = valueSchema.safeParse(content)

  return scalar.success ? [{ path, at, value: String(scalar.data) }] : []
}

function nodeEntries(
  nodes: ReadonlyArray<DocumentStructureNode>,
  content: JsonContent | undefined,
  at: number[],
): OutputEntry[] {
  const object = jsonObjectSchema.safeParse(content)

  if (!object.success) {
    return []
  }

  return nodes.flatMap((node) => {
    const value = object.data[node.name]

    switch (node.kind) {
      case 'field':
        return scalarEntries(node.path, value, at)
      case 'object':
        return nodeEntries(node.children, value, at)
      case 'array': {
        const list = jsonListSchema.safeParse(value)
        const { items } = node

        return (list.success ? list.data : []).flatMap((element, index) =>
          items.kind === 'field'
            ? scalarEntries(items.path, element, [...at, index])
            : nodeEntries(items.children, element, [...at, index]),
        )
      }
    }
  })
}

export function documentEntries(
  structure: { children: ReadonlyArray<DocumentStructureNode> },
  content: JsonContent,
): OutputEntry[] {
  return nodeEntries(structure.children, content, [])
}
