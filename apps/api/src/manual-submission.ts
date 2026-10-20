import { Effect } from 'effect'

import {
  type DocumentEncoding,
  documentUndecodableProblem,
  type ManualSubmission,
  type ManualSubmissionInput,
} from '@edi-bridge/contracts'
import { postgresDocumentStorage } from '@edi-bridge/db'
import {
  Database,
  decodeDocument,
  Documents,
  namesOtherEncoding,
  receive,
} from '@edi-bridge/pipeline'

import { Db } from './db.js'
import { DocumentUndecodable } from './errors.js'
import { listRunSummaries } from './run.js'
import { CurrentWorkspace } from './workspace.js'

// The person sees the refusal in the sheet and can choose another encoding, so nothing undecodable
// is stored.
const decodedContent = (channelId: string, content: string, encoding: DocumentEncoding) =>
  Effect.gen(function* () {
    const decoded = decodeDocument(Buffer.from(content, 'base64'), encoding)
    const { characterSet } = decoded

    if ('undecodable' in decoded) {
      return yield* new DocumentUndecodable({
        problem: documentUndecodableProblem(
          decoded.undecodable.message,
          characterSet === undefined ? encoding : null,
        ),
      })
    }

    if (characterSet !== undefined && namesOtherEncoding(characterSet, encoding)) {
      yield* Effect.logWarning(
        `A Manual Submission on Channel ${channelId} names the encoding ${encoding}, its UNB ${characterSet}; it is decoded in ${characterSet}`,
      )
    }

    return decoded
  })

export const submitDocument = (input: ManualSubmissionInput) =>
  Effect.gen(function* () {
    const db = yield* Db
    const workspace = yield* CurrentWorkspace
    const { fileName, content, encoding } = input.document

    const receipt = yield* receive({
      workspaceId: workspace.id,
      channelId: input.channelId,
      fileName,
      content: yield* decodedContent(input.channelId, content, encoding),
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
