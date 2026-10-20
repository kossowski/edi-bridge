import {
  type ChannelSummary,
  type Direction,
  directionOf,
  directions,
  type DocumentStructureSummary,
  type MappingVersionSummary,
} from '@edi-bridge/contracts'

import { type ChannelFormValues, type ChannelKindKey } from '../channels/channel-form-values'
import { suggestedName, wayKind } from './partner-connections'
import { flowName, ownConnections } from './partner-documents'
import { type WizardDocument, type WizardResult } from './partner-wizard-state'

export type PlanChannel = Pick<ChannelSummary, 'id' | 'name' | 'direction' | 'tradingPartnerId'>

export type PlannedConnection = {
  direction: Direction
  kind: ChannelKindKey
  values: ChannelFormValues
}

export type LeftReason =
  | 'connectionPostponed'
  | 'noOwnConnection'
  | 'severalOwnConnections'
  | 'mappingDraft'
  | 'mappingLater'

export type PlannedRoute<Channel extends PlanChannel> = {
  name: string
  direction: Direction
  partnerConnection: PlannedConnection
  ownChannel: Channel
  mappingVersion: MappingVersionSummary
}

export type PlannedDocument<Channel extends PlanChannel> = { messageType: WizardDocument } & (
  | { route: PlannedRoute<Channel> }
  | { reasons: LeftReason[] }
)

export type PlannedMappingDraft = { messageType: WizardDocument; documentStructureId: string }

export type SkippedMappingDraft = {
  messageType: WizardDocument
  reason: 'noDocumentStructure' | 'severalDocumentStructures'
}

export type SetupPlan<Channel extends PlanChannel> = {
  partner: WizardResult['partner']
  connections: PlannedConnection[]
  mappingDrafts: PlannedMappingDraft[]
  skippedMappingDrafts: SkippedMappingDraft[]
  documents: PlannedDocument<Channel>[]
}

export type SetupContext<Channel extends PlanChannel> = {
  channels: ReadonlyArray<Channel>
  mappingVersions: ReadonlyArray<MappingVersionSummary>
  documentStructures: ReadonlyArray<Pick<DocumentStructureSummary, 'id'>>
  names: {
    connection: (kind: ChannelKindKey) => string
    route: (messageType: WizardDocument) => string
  }
}

function plannedConnections(
  { connections }: WizardResult,
  names: SetupContext<PlanChannel>['names'],
): PlannedConnection[] {
  return directions.flatMap((direction) => {
    const connection = connections[direction]

    if (connection === undefined || connection.way === 'ask') {
      return []
    }

    const kind = wayKind(direction, connection.way)

    return [
      {
        direction,
        kind,
        values: { ...connection.values, kind, name: suggestedName(names.connection(kind)) },
      },
    ]
  })
}

function plannedDocument<Channel extends PlanChannel>(
  messageType: WizardDocument,
  result: WizardResult,
  connections: ReadonlyArray<PlannedConnection>,
  { channels, mappingVersions, names }: SetupContext<Channel>,
): PlannedDocument<Channel> {
  const direction = directionOf({ messageType })
  const own = ownConnections(channels, messageType)
  const mapping = result.mappings[messageType]

  const mappingVersion =
    mapping?.way === 'existing'
      ? mappingVersions.find(({ id }) => id === mapping.mappingVersionId)
      : undefined

  const partnerConnection = connections.find((connection) => connection.direction === direction)

  const reasons: LeftReason[] = []

  if (partnerConnection === undefined) {
    reasons.push('connectionPostponed')
  }

  if (own.length === 0) {
    reasons.push('noOwnConnection')
  } else if (own.length > 1) {
    reasons.push('severalOwnConnections')
  }

  if (mapping?.way === 'ai') {
    reasons.push('mappingDraft')
  } else if (mappingVersion === undefined) {
    reasons.push('mappingLater')
  }

  const [ownChannel] = own

  if (
    reasons.length > 0 ||
    partnerConnection === undefined ||
    ownChannel === undefined ||
    mappingVersion === undefined
  ) {
    return { messageType, reasons }
  }

  return {
    messageType,
    route: {
      name: flowName(names.route(messageType)),
      direction,
      partnerConnection,
      ownChannel,
      mappingVersion,
    },
  }
}

// A Mapping Draft names its Document Structure; the wizard picks one only when the Workspace has
// exactly one, and leaves the choice to the create step otherwise.
function plannedMappingDrafts(
  result: WizardResult,
  documentStructures: SetupContext<PlanChannel>['documentStructures'],
): Pick<SetupPlan<PlanChannel>, 'mappingDrafts' | 'skippedMappingDrafts'> {
  const drafts = result.documents.filter(
    (messageType) => result.mappings[messageType]?.way === 'ai',
  )

  const [only, ...others] = documentStructures

  if (only !== undefined && others.length === 0) {
    return {
      mappingDrafts: drafts.map((messageType) => ({ messageType, documentStructureId: only.id })),
      skippedMappingDrafts: [],
    }
  }

  const reason = only === undefined ? 'noDocumentStructure' : 'severalDocumentStructures'

  return {
    mappingDrafts: [],
    skippedMappingDrafts: drafts.map((messageType) => ({ messageType, reason })),
  }
}

export function setupPlan<Channel extends PlanChannel>(
  result: WizardResult,
  context: SetupContext<Channel>,
): SetupPlan<Channel> {
  const connections = plannedConnections(result, context.names)

  return {
    partner: result.partner,
    connections,
    ...plannedMappingDrafts(result, context.documentStructures),
    documents: result.documents.map((messageType) =>
      plannedDocument(messageType, result, connections, context),
    ),
  }
}
