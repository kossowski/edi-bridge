import {
  type FixTarget,
  type MappingVersionSummary,
  type ProblemReason,
  type RunError,
  type RunProblem,
  type RunSummary,
  whoFixes,
} from '@edi-bridge/contracts'

import type { ChannelStore } from './channel'
import type { FlowStore } from './flow'
import type { MissingPiece } from './interchange'
import type { LookupTableStore } from './lookup-table'

export type ProblemSources = {
  flows: FlowStore
  channels: ChannelStore
  lookupTables: LookupTableStore
}

const reasons = new Map<string, ProblemReason>([
  ['invalidCharacter', 'unreadable'],
  ['segmentCountMismatch', 'unreadable'],
  ['missingComponent', 'invalidContent'],
  ['unknownCode', 'invalidContent'],
  ['invalidDate', 'invalidContent'],
  ['lookupMissing', 'missingCode'],
  ['missingSourceField', 'missingField'],
  ['destinationUnreachable', 'unreachable'],
  ['destinationUnavailable', 'unreachable'],
])

function mappingTarget(mapping: MappingVersionSummary | null, fieldPath: string): FixTarget | null {
  return (
    mapping && {
      kind: 'mapping',
      mappingId: mapping.mappingId,
      name: mapping.mappingName,
      fieldPath,
    }
  )
}

function fixTargetOf(
  run: RunSummary,
  reason: ProblemReason,
  missing: MissingPiece | null,
  mapping: MappingVersionSummary | null,
  sources: ProblemSources,
): FixTarget | null {
  switch (reason) {
    case 'unreadable':
    case 'invalidContent': {
      return run.direction === 'inbound'
        ? {
            kind: 'tradingPartner',
            tradingPartnerId: run.tradingPartner.id,
            name: run.tradingPartner.name,
          }
        : mappingTarget(mapping, 'supplier.gln')
    }

    case 'missingCode': {
      if (missing?.kind !== 'code') {
        return null
      }

      const table = sources.lookupTables.all().find(({ name }) => name === missing.lookupTableName)

      return table
        ? { kind: 'lookupTable', lookupTableId: table.id, name: table.name, code: missing.code }
        : null
    }

    case 'missingField': {
      return missing?.kind === 'field' ? mappingTarget(mapping, missing.fieldPath) : null
    }

    case 'unreachable': {
      const flow = sources.flows.get(run.flow.id)
      const channel = flow && sources.channels.get(flow.destinationChannelId)

      return channel ? { kind: 'channel', channelId: channel.id, name: channel.name } : null
    }
  }
}

export function problemOf(
  run: RunSummary,
  { error, missing }: { error: RunError | null; missing: MissingPiece | null },
  mapping: MappingVersionSummary | null,
  sources: ProblemSources,
): RunProblem | null {
  const fixer = whoFixes(run)
  const reason = error && reasons.get(error.code)

  if (fixer === null || !error || !reason) {
    return null
  }

  return {
    reason,
    whoFixes: fixer,
    fixTarget: fixTargetOf(run, reason, missing, mapping, sources),
  }
}
