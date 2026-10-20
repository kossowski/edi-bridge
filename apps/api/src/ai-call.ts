import { type FlexibleSchema, generateText, type LanguageModel, Output } from 'ai'
import { Cause, Duration, Effect } from 'effect'

import type { FastifyBaseLogger } from 'fastify'

import { recordAiTokenUsage, tokensOf } from './ai-budget.js'

import type { Db } from './db.js'
import type { CurrentWorkspace } from './workspace.js'

export interface AiCall<Answer, Result> {
  model: LanguageModel
  instructions: string
  prompt: string
  schema: FlexibleSchema<Answer>
  timeoutMs: number
  log: FastifyBaseLogger
  failureMessage: string
  onAnswer: (answer: Answer) => Result
  onFailure: Result
}

// A closing tag inside the text of a data line would end its data block early.
export const dataLine = (value: Readonly<Record<string, string | null>>) =>
  JSON.stringify(value).replaceAll('<', String.raw`\u003c`)

export const callAi = <Answer, Result>({
  model,
  instructions,
  prompt,
  schema,
  timeoutMs,
  log,
  failureMessage,
  onAnswer,
  onFailure,
}: AiCall<Answer, Result>): Effect.Effect<Result, never, CurrentWorkspace | Db> => {
  let tokens = 0

  return Effect.tryPromise((abortSignal) =>
    generateText({
      model,
      instructions,
      prompt,
      output: Output.object({ schema }),
      abortSignal,
      // An answer that fails validation still used its tokens.
      onStepEnd: ({ usage }) => {
        tokens += tokensOf(usage)
      },
    }),
  ).pipe(
    Effect.timeout(Duration.millis(timeoutMs)),
    Effect.map(({ output }) => onAnswer(output)),
    Effect.catchCause((cause) =>
      Effect.as(
        Effect.sync(() => log.warn({ err: Cause.squash(cause) }, failureMessage)),
        onFailure,
      ),
    ),
    // Outside the catch, so a failed recording fails the request instead of passing as a model failure.
    Effect.ensuring(Effect.suspend(() => recordAiTokenUsage(tokens))),
  )
}
