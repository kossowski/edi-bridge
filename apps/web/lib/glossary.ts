import type { Messages } from 'next-intl'

import { type MessageType, messageTypes } from '@edi-bridge/contracts'

export type GlossaryTermKey = keyof Messages['Help']['terms']

export type GlossaryKey = GlossaryTermKey | MessageType

export type GlossaryEntry =
  | { kind: 'term'; key: GlossaryTermKey; id: string; term: string }
  | { kind: 'messageType'; key: MessageType; id: string; term: string }

const termEntries: ReadonlyArray<GlossaryEntry> = [
  { kind: 'term', key: 'workspace', id: 'workspace', term: 'Workspace' },
  { kind: 'term', key: 'showcaseWorkspace', id: 'showcase-workspace', term: 'Showcase Workspace' },
  { kind: 'term', key: 'tradingPartner', id: 'trading-partner', term: 'Trading Partner' },
  { kind: 'term', key: 'testMode', id: 'test-mode', term: 'Test Mode' },
  { kind: 'term', key: 'interchange', id: 'interchange', term: 'Interchange' },
  { kind: 'term', key: 'acknowledgement', id: 'acknowledgement', term: 'Acknowledgement' },
  { kind: 'term', key: 'overdue', id: 'overdue', term: 'Overdue' },
  { kind: 'term', key: 'businessReference', id: 'business-reference', term: 'Business Reference' },
  { kind: 'term', key: 'orderLifecycle', id: 'order-lifecycle', term: 'Order Lifecycle' },
  { kind: 'term', key: 'channel', id: 'channel', term: 'Channel' },
  { kind: 'term', key: 'documentStructure', id: 'document-structure', term: 'Document Structure' },
  { kind: 'term', key: 'mapping', id: 'mapping', term: 'Mapping' },
  { kind: 'term', key: 'lookupTable', id: 'lookup-table', term: 'Lookup Table' },
  { kind: 'term', key: 'mappingVersion', id: 'mapping-version', term: 'Mapping Version' },
  { kind: 'term', key: 'draft', id: 'draft', term: 'Draft' },
  { kind: 'term', key: 'sampleDocument', id: 'sample-document', term: 'Sample Document' },
  { kind: 'term', key: 'manualSubmission', id: 'manual-submission', term: 'Manual Submission' },
  { kind: 'term', key: 'flow', id: 'flow', term: 'Flow' },
  { kind: 'term', key: 'run', id: 'run', term: 'Run' },
  { kind: 'term', key: 'duplicate', id: 'duplicate', term: 'Duplicate' },
  { kind: 'term', key: 'retry', id: 'retry', term: 'Retry' },
  { kind: 'term', key: 'reprocess', id: 'reprocess', term: 'Reprocess' },
]

const messageTypeEntries: ReadonlyArray<GlossaryEntry> = messageTypes.map((messageType) => ({
  kind: 'messageType',
  key: messageType,
  id: messageType.toLowerCase(),
  term: `Message Type ${messageType}`,
}))

export const glossaryEntries: ReadonlyArray<GlossaryEntry> = [...termEntries, ...messageTypeEntries]

export function glossaryEntry(key: GlossaryKey) {
  const entry = glossaryEntries.find((candidate) => candidate.key === key)

  if (!entry) {
    throw new Error(`No glossary entry for ${key}`)
  }

  return entry
}

export function helpHref(key: GlossaryKey) {
  return `/help#${glossaryEntry(key).id}`
}
