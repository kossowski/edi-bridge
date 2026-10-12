import { maxChangeNoteLength } from '@edi-bridge/contracts'

import type { FlowInUse } from './version-history'

export type ChangeNoteProblem = 'missing' | 'tooLong'

export function changeNoteProblem(note: string): ChangeNoteProblem | null {
  const trimmed = note.trim()

  if (trimmed === '') {
    return 'missing'
  }

  return trimmed.length > maxChangeNoteLength ? 'tooLong' : null
}

export function chosenFlowIds(
  flows: ReadonlyArray<FlowInUse>,
  chosen: ReadonlySet<string>,
): string[] {
  return flows.flatMap(({ id }) => (chosen.has(id) ? [id] : []))
}
