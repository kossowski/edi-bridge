import { Context, type Effect } from 'effect'

import type {
  DeliveryFailed,
  DownloadFailed,
  OutboundDocument,
  SftpChannel,
  SftpFile,
} from '@edi-bridge/channels'
import type { channels, Connection, DocumentStorage } from '@edi-bridge/db'

import type { RunNotQueued } from './errors'

export class Database extends Context.Service<Database, Connection['db']>()(
  '@edi-bridge/pipeline/Database',
) {}

export class Documents extends Context.Service<Documents, DocumentStorage>()(
  '@edi-bridge/pipeline/Documents',
) {}

export type QueuedRun = { workspaceId: string; runId: string }

export type RunQueueService = {
  enqueue: (run: QueuedRun) => Effect.Effect<void, RunNotQueued>
}

export class RunQueue extends Context.Service<RunQueue, RunQueueService>()(
  '@edi-bridge/pipeline/RunQueue',
) {}

export type DestinationChannel = typeof channels.$inferSelect

export type DeliveryService = (
  channel: DestinationChannel,
  document: OutboundDocument,
) => Effect.Effect<void, DeliveryFailed>

export class Delivery extends Context.Service<Delivery, DeliveryService>()(
  '@edi-bridge/pipeline/Delivery',
) {}

export type DownloadService = {
  list: (channel: SftpChannel) => Effect.Effect<SftpFile[], DownloadFailed>
  read: (channel: SftpChannel, name: string) => Effect.Effect<Buffer, DownloadFailed>
  remove: (channel: SftpChannel, name: string) => Effect.Effect<void, DownloadFailed>
}

export class Download extends Context.Service<Download, DownloadService>()(
  '@edi-bridge/pipeline/Download',
) {}
