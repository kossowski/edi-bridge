import { and, DrizzleQueryError, eq, inArray } from 'drizzle-orm'
import { DateTime, Effect } from 'effect'

import {
  type Direction,
  directionOf,
  type FailureStage,
  type ProblemReason,
  type RunStatus,
  whoFixes,
} from '@edi-bridge/contracts'
import { flows, mappingVersions, runs, runSteps } from '@edi-bridge/db'

import { MappingVersionNotOfRun, RunNotReprocessable } from './errors'
import { queueOrLeaveToSweep } from './queue-received-runs'
import { Database, type QueuedRun } from './services'
import { stagesOf } from './stages'

export type Reprocess = QueuedRun & { mappingVersionId: string }

type Reprocessable = {
  status: RunStatus
  failureStage: FailureStage | null
  direction: Direction
  problem: { reason: ProblemReason } | null
  mappingVersionId: string | null
}

// The Trading Partner fixes its Document by a resend, and a delivery failure by a Retry.
export const isReprocessable = <R extends Reprocessable>(
  run: R,
): run is R & { mappingVersionId: string } =>
  run.status === 'failed' &&
  run.failureStage !== null &&
  run.failureStage !== 'delivery' &&
  run.problem !== null &&
  run.mappingVersionId !== null &&
  whoFixes({
    failureStage: run.failureStage,
    direction: run.direction,
    problem: run.problem,
  }) !== 'tradingPartner'

// The new Run takes the same, unmodified Document; the replaced Run stays failed.
export const reprocessRun = ({ workspaceId, runId, mappingVersionId }: Reprocess) =>
  Effect.gen(function* () {
    const db = yield* Database
    const receivedAt = yield* DateTime.nowAsDate

    const started = yield* Effect.promise(() =>
      db.transaction(
        async (
          tx,
        ): Promise<Effect.Effect<{ id: string }, RunNotReprocessable | MappingVersionNotOfRun>> => {
          // Locks the replaced Run, so two Reprocesses of it start one new Run.
          const [found] = await tx
            .select({ run: runs, flow: flows })
            .from(runs)
            .innerJoin(flows, eq(flows.id, runs.flowId))
            .where(and(eq(runs.workspaceId, workspaceId), eq(runs.id, runId)))
            .for('update', { of: runs })

          if (found === undefined) {
            return Effect.fail(new RunNotReprocessable({ runId }))
          }

          const run = { ...found.run, direction: directionOf(found.flow) }
          const { flow } = found

          const [replacing] = await tx
            .select({ id: runs.id })
            .from(runs)
            .where(eq(runs.replacesRunId, run.id))

          if (replacing !== undefined || !isReprocessable(run)) {
            return Effect.fail(new RunNotReprocessable({ runId }))
          }

          const [chosen] = await tx
            .select({ id: mappingVersions.id })
            .from(mappingVersions)
            .where(
              and(
                eq(mappingVersions.id, mappingVersionId),
                inArray(
                  mappingVersions.mappingId,
                  tx
                    .select({ mappingId: mappingVersions.mappingId })
                    .from(mappingVersions)
                    .where(eq(mappingVersions.id, run.mappingVersionId)),
                ),
              ),
            )

          if (chosen === undefined) {
            return Effect.fail(new MappingVersionNotOfRun({ runId, mappingVersionId }))
          }

          const [created] = await tx
            .insert(runs)
            .values({
              workspaceId,
              documentId: run.documentId,
              flowId: run.flowId,
              tradingPartnerId: run.tradingPartnerId,
              mappingVersionId: chosen.id,
              manualSubmission: run.manualSubmission,
              messageIndex: run.messageIndex,
              replacesRunId: run.id,
              receivedAt,
            })
            .returning({ id: runs.id })

          if (created === undefined) {
            throw new Error('Run insert returned no row')
          }

          // The Document was received already, so the receipt of the new Run succeeds at once.
          await tx.insert(runSteps).values(
            stagesOf(flow).map((stage, position) =>
              stage === 'receipt'
                ? {
                    runId: created.id,
                    position,
                    stage,
                    status: 'succeeded' as const,
                    startedAt: receivedAt,
                    finishedAt: receivedAt,
                  }
                : { runId: created.id, position, stage },
            ),
          )

          return Effect.succeed(created)
        },
      ),
    ).pipe(
      Effect.flatten,
      // The unique link to the replaced Run stops a second Reprocess that passed the check at once.
      Effect.catchDefect((defect) =>
        defect instanceof DrizzleQueryError &&
        defect.cause !== undefined &&
        'constraint_name' in defect.cause &&
        defect.cause.constraint_name === 'runs_replacesRunId_unique'
          ? Effect.fail(new RunNotReprocessable({ runId }))
          : Effect.die(defect),
      ),
    )

    const queued = { workspaceId, runId: started.id }

    yield* queueOrLeaveToSweep(queued, 'Reprocessed')

    return queued
  })
