export type Status = 'M' | 'C'

export interface SegmentEntry {
  kind: 'segment'
  tag: string
  status: Status
  maxRepetitions: number
}

export interface GroupEntry {
  kind: 'group'
  group: number
  status: Status
  maxRepetitions: number
  trigger: string
  entries: StructureEntry[]
}

export type StructureEntry = SegmentEntry | GroupEntry

export interface MessageIdentifier {
  type: string
  version: string
  release: string
  controllingAgency: string
}

export interface MessageDefinition {
  identifier: MessageIdentifier
  segments: StructureEntry[]
}

export const segment = (tag: string, status: Status, maxRepetitions: number): SegmentEntry => ({
  kind: 'segment',
  tag,
  status,
  maxRepetitions,
})

export const group = (
  group: number,
  status: Status,
  maxRepetitions: number,
  trigger: string,
  entries: StructureEntry[],
): GroupEntry => ({ kind: 'group', group, status, maxRepetitions, trigger, entries })
