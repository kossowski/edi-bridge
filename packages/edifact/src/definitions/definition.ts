export type Status = 'M' | 'C'

export interface SegmentEntry {
  segment: string
  status: Status
  maxRepetitions: number
}

// The first entry of a segment group is its trigger segment.
export interface GroupEntry {
  group: number
  status: Status
  maxRepetitions: number
  entries: [SegmentEntry, ...StructureEntry[]]
}

export type StructureEntry = SegmentEntry | GroupEntry

export interface MessageIdentifier {
  type: string
  version: string
  release: string
  controllingAgency: string
}

// The structure lists the segments between UNH and UNT, which parse already checks.
export interface MessageDefinition {
  identifier: MessageIdentifier
  structure: StructureEntry[]
}

export const segment = (segment: string, status: Status, maxRepetitions: number): SegmentEntry => ({
  segment,
  status,
  maxRepetitions,
})

export const group = (
  group: number,
  status: Status,
  maxRepetitions: number,
  entries: [SegmentEntry, ...StructureEntry[]],
): GroupEntry => ({ group, status, maxRepetitions, entries })
