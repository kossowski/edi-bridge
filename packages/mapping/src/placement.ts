import type { EdifactSegment, EdifactStructureNode } from '@edi-bridge/contracts'
import type { Message, Segment } from '@edi-bridge/edifact'

export type Occurrences = {
  segments: Map<string, Segment[]>
  groups: Map<string, Occurrences[]>
}

// Every qualifier of the EANCOM directory is the first value of its segment.
const matches = (node: EdifactSegment, segment: Segment) =>
  node.tag === segment.tag &&
  (node.qualifier === null || segment.elements[0]?.[0] === node.qualifier.code)

function entryOf(node: EdifactStructureNode): EdifactSegment {
  const [first] = node.kind === 'segment' ? [node] : node.children

  if (first?.kind !== 'segment') {
    throw new Error(`The segment group ${node.path} does not start with a segment`)
  }

  return first
}

function segmentNodes(nodes: ReadonlyArray<EdifactStructureNode>): EdifactSegment[] {
  return nodes.flatMap((node) => (node.kind === 'segment' ? [node] : segmentNodes(node.children)))
}

type MessageSegments = {
  segments: ReadonlyArray<Segment>
  isInStructure: (segment: Segment) => boolean
}

type PlaceResult = { occurrences: Occurrences; next: number }

const countOf = (occurrences: Occurrences, node: EdifactStructureNode) =>
  (node.kind === 'segment' ? occurrences.segments : occurrences.groups).get(node.path)?.length ?? 0

// A segment placed at a higher level closes the open segment groups instead of being skipped.
function place(
  nodes: ReadonlyArray<EdifactStructureNode>,
  { segments, isInStructure }: MessageSegments,
  start: number,
  outermost = false,
): PlaceResult {
  const occurrences: Occurrences = { segments: new Map(), groups: new Map() }
  let index = start
  let position = 0

  while (index < segments.length) {
    const segment = segments[index]!

    const found = nodes.findIndex(
      (node, at) =>
        at >= position &&
        countOf(occurrences, node) < node.maxRepeat &&
        matches(entryOf(node), segment),
    )

    if (found === -1) {
      if (outermost || !isInStructure(segment)) {
        index += 1
        continue
      }

      break
    }

    position = found
    const node = nodes[found]!

    if (node.kind === 'segment') {
      occurrences.segments.set(node.path, [...(occurrences.segments.get(node.path) ?? []), segment])
      index += 1
      continue
    }

    const inner = place(node.children, { segments, isInStructure }, index)

    occurrences.groups.set(node.path, [
      ...(occurrences.groups.get(node.path) ?? []),
      inner.occurrences,
    ])
    index = inner.next
  }

  return { occurrences, next: index }
}

export function placeMessage(
  nodes: ReadonlyArray<EdifactStructureNode>,
  message: Message,
): Occurrences {
  const structureSegments = segmentNodes(nodes)

  return place(
    nodes,
    {
      segments: [message.header, ...message.segments, message.trailer],
      isInStructure: (segment) => structureSegments.some((node) => matches(node, segment)),
    },
    0,
    true,
  ).occurrences
}
