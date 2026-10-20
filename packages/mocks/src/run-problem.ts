import {
  type Fixer,
  type FixTarget,
  type MappingVersionSummary,
  type ProblemReason,
  type RunProblem,
  type RunSummary,
  whoFixes,
} from '@edi-bridge/contracts'

import { seedWorkspace } from './workspace'

import type { ChannelStore } from './channel'
import type { FlowStore } from './flow'
import type { BrokenPiece, GeneratedErrorCode, GeneratedMessage } from './interchange'
import type { LookupTableStore } from './lookup-table'

export type ProblemSources = {
  flows: FlowStore
  channels: ChannelStore
  lookupTables: LookupTableStore
}

const reasons = {
  invalidCharacter: 'unreadable',
  segmentCountMismatch: 'unreadable',
  'missing-element': 'invalidContent',
  'too-long-element': 'invalidContent',
  'unknown-code': 'invalidContent',
  'wrong-format': 'invalidContent',
  lookupMissing: 'missingCode',
  missingSourceField: 'missingField',
  destinationUnreachable: 'unreachable',
  destinationUnavailable: 'unreachable',
  hostKeyMismatch: 'hostKeyMismatch',
  glnMissing: 'incompleteSetup',
  channelDefect: 'incompleteSetup',
  characterSetUnsupported: 'incompleteSetup',
  processingDefect: 'defect',
} as const satisfies Record<GeneratedErrorCode, ProblemReason>

function destinationChannelOf(run: RunSummary, sources: ProblemSources) {
  const flow = sources.flows.get(run.flow.id)

  return flow && sources.channels.get(flow.destinationChannelId)
}

function destinationChannelTarget(run: RunSummary, sources: ProblemSources): FixTarget | null {
  const channel = destinationChannelOf(run, sources)

  return channel ? { kind: 'channel', channelId: channel.id, name: channel.name } : null
}

function brokenPieceTarget(
  run: RunSummary,
  broken: BrokenPiece | null,
  mapping: MappingVersionSummary | null,
  sources: ProblemSources,
): FixTarget | null {
  switch (broken?.kind) {
    case undefined: {
      return null
    }

    case 'mapping': {
      return (
        mapping && {
          kind: 'mapping',
          mappingId: mapping.mappingId,
          name: mapping.mappingName,
          fieldPath: broken.fieldPath,
        }
      )
    }

    case 'lookupTable': {
      const table = sources.lookupTables.all().find(({ name }) => name === broken.name)

      return table
        ? { kind: 'lookupTable', lookupTableId: table.id, name: table.name, code: broken.code }
        : null
    }

    case 'workspaceGln': {
      return { kind: 'workspaceGln', name: seedWorkspace.name }
    }

    case 'tradingPartnerGln': {
      return {
        kind: 'tradingPartnerGln',
        tradingPartnerId: run.tradingPartner.id,
        name: run.tradingPartner.name,
      }
    }

    case 'tradingPartner': {
      return {
        kind: 'tradingPartner',
        tradingPartnerId: run.tradingPartner.id,
        name: run.tradingPartner.name,
      }
    }

    case 'channelCredential': {
      const channel = destinationChannelOf(run, sources)

      return channel
        ? { kind: 'channelCredential', channelId: channel.id, name: channel.name }
        : null
    }
  }
}

function fixTargetOf(
  run: RunSummary,
  fixer: Fixer,
  reason: ProblemReason,
  broken: BrokenPiece | null,
  mapping: MappingVersionSummary | null,
  sources: ProblemSources,
): FixTarget | null {
  switch (fixer) {
    case 'tradingPartner': {
      return {
        kind: 'tradingPartner',
        tradingPartnerId: run.tradingPartner.id,
        name: run.tradingPartner.name,
      }
    }

    case 'retry': {
      if (broken !== null) {
        return brokenPieceTarget(run, broken, mapping, sources)
      }

      return destinationChannelTarget(run, sources)
    }

    case 'you': {
      return reason === 'hostKeyMismatch'
        ? destinationChannelTarget(run, sources)
        : brokenPieceTarget(run, broken, mapping, sources)
    }
  }
}

export function problemOf(
  run: RunSummary,
  { error, broken }: Pick<GeneratedMessage, 'error' | 'broken'>,
  mapping: MappingVersionSummary | null,
  sources: ProblemSources,
): RunProblem | null {
  const fixer = whoFixes(run)

  if (fixer === null || error === null) {
    return null
  }

  const reason = reasons[error.code]

  // A Defect lies in EDI Bridge, so nothing in the Workspace fixes it.
  return {
    reason,
    whoFixes: fixer,
    fixTarget:
      reason === 'defect' ? null : fixTargetOf(run, fixer, reason, broken, mapping, sources),
  }
}
