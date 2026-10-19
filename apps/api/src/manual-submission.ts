import { Effect } from 'effect'

import { postgresDocumentStorage } from '@edi-bridge/db'
import { Database, Documents, receive } from '@edi-bridge/pipeline'

import type { ManualSubmission, ManualSubmissionInput } from '@edi-bridge/contracts'

import { Db } from './db.js'
import { listRunSummaries } from './run.js'
import { CurrentWorkspace } from './workspace.js'

export const submitDocument = (input: ManualSubmissionInput) =>
  Effect.gen(function* () {
    const db = yield* Db
    const workspace = yield* CurrentWorkspace

    const receipt = yield* receive({
      workspaceId: workspace.id,
      channelId: input.channelId,
      fileName: input.document.fileName,
      content: input.document.content,
      manualSubmission: true,
    }).pipe(
      Effect.provideService(Database, db),
      Effect.provideService(Documents, postgresDocumentStorage(db)),
    )

    const runs = yield* Effect.promise(() =>
      listRunSummaries(
        db,
        receipt.runs.map(({ id }) => id),
      ),
    )

    return { runs, notRouted: receipt.notRouted } satisfies ManualSubmission
  })
