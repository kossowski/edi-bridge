import type { EdifactComposite, EdifactSegment, EdifactStructureNode } from '@edi-bridge/contracts'

export type StructurePart =
  EdifactStructureNode | EdifactSegment['children'][number] | EdifactComposite['children'][number]

export const childrenOf = (part: StructurePart): ReadonlyArray<StructurePart> =>
  part.kind === 'element' ? [] : part.children

export function elementPaths(parts: ReadonlyArray<StructurePart>): string[] {
  return parts.flatMap((part) =>
    part.kind === 'element' ? [part.path] : elementPaths(childrenOf(part)),
  )
}
