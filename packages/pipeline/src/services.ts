import { Context, type Effect } from 'effect'

import type { Connection, DocumentStorage } from '@edi-bridge/db'

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
