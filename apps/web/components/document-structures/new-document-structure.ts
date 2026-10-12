import { type DocumentStructureNode, documentStructureNodes } from '@edi-bridge/contracts'

export type LabelChoices = ReadonlyMap<string, string>

export function namesToCheck(
  children: ReadonlyArray<DocumentStructureNode>,
  choices: LabelChoices,
): DocumentStructureNode[] {
  return [...documentStructureNodes(children)].flatMap(({ node }) =>
    node.labelUnsure && !choices.has(node.path) ? [node] : [],
  )
}

export type ReadProgress = 'opening' | 'reading' | 'read'

const readingStepKeys = ['opening', 'finding', 'naming'] as const

export type ReadingStepKey = (typeof readingStepKeys)[number]

export type ReadingStepState = 'done' | 'active' | 'pending'

const activeStepOf = { opening: 0, reading: 1, read: readingStepKeys.length } as const

export function readingSteps(
  progress: ReadProgress,
): Array<{ key: ReadingStepKey; state: ReadingStepState }> {
  const active = activeStepOf[progress]

  return readingStepKeys.map((key, index) => ({
    key,
    state: index < active ? 'done' : index === active ? 'active' : 'pending',
  }))
}

export type SaveBlock = { reason: 'names'; count: number } | { reason: 'name' }

export function saveBlock(toCheck: number, name: string): SaveBlock | null {
  if (toCheck > 0) {
    return { reason: 'names', count: toCheck }
  }

  return name.trim() === '' ? { reason: 'name' } : null
}
