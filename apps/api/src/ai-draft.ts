import {
  generateText,
  isStepCount,
  NoObjectGeneratedError,
  NoOutputGeneratedError,
  type LanguageModel,
  type ModelMessage,
  Output,
  tool,
} from 'ai'
import { Effect } from 'effect'
import { z } from 'zod'

import {
  type AiDraftStep,
  type AiProposal,
  documentStructureLeaves,
  type EdifactComposite,
  type EdifactElement,
  type EdifactSegment,
  type EdifactStructureNode,
  edifactLeaves,
  type MappingGraph,
  type MappingLink,
  mappingGraphSchema,
  type MessageType,
  oriented,
  mappingLinkSchema,
  mappingSideLeaves,
  messageTypeStructures,
  transformLinkTargets,
  unknownPaths,
} from '@edi-bridge/contracts'

import type { MappingError, MappingErrorCode } from '@edi-bridge/mapping'

import { tokensOf } from './ai-budget.js'
import { AiDraftFailed } from './errors.js'
import { type Engine, type Loaded, loadSamples, startEngine } from './mapping-preview.js'

const aiLinkListSchema = z.object({ links: z.array(mappingLinkSchema) })

const aiDraftRounds = 3

export type AiDraftRequest = {
  mappingId: string
  sampleId: string
  model: LanguageModel
  onStep: (step: AiDraftStep) => void
  // Reports the running token count, so a run cut short still counts against the budget.
  onTokens?: (tokens: number) => void
}

const toProposal = (links: ReadonlyArray<MappingLink>): AiProposal => ({
  links: [...links],
  transforms: [],
  transformLinks: [],
})

export const withProposal = (draft: MappingGraph, proposal: AiProposal): MappingGraph => ({
  links: [...draft.links, ...proposal.links],
  transforms: [...draft.transforms, ...proposal.transforms],
  transformLinks: [...draft.transformLinks, ...proposal.transformLinks],
})

const engineMessages: Record<MappingErrorCode, (error: MappingError) => string> = {
  missingRequiredValue: ({ targetPath }) => `No value reaches the required target ${targetPath}`,
  outsideLoop: ({ targetPath }) => `${targetPath} repeats, but its link is outside a loop`,
  unknownSource: ({ sourcePath, targetPath }) =>
    `The sample has no value at ${sourcePath ?? 'the source'} for ${targetPath}`,
  unknownTarget: ({ targetPath }) => `The target has no element at ${targetPath}`,
  invalidTransform: ({ targetPath }) => `A transform for ${targetPath} is not usable`,
  invalidDate: ({ sourcePath, targetPath }) =>
    `The value at ${sourcePath ?? 'the source'} is no date ${targetPath} accepts`,
  invalidNumber: ({ sourcePath, targetPath }) =>
    `The value at ${sourcePath ?? 'the source'} is no number ${targetPath} accepts`,
  unknownLookupTable: ({ targetPath }) => `The Lookup Table for ${targetPath} does not exist`,
  noLookupMatch: ({ targetPath }) => `The Lookup Table for ${targetPath} has no matching entry`,
  expressionFailed: ({ targetPath }) => `The expression for ${targetPath} failed`,
}

const linkedTargets = (graph: MappingGraph) => [
  ...graph.links.map(({ targetPath }) => targetPath),
  ...transformLinkTargets(graph.transformLinks),
]

// A target takes one link at most, so a link the Draft already has for a target wins.
export const unlinkedProposal = (draft: MappingGraph, proposal: AiProposal): AiProposal => {
  const linked = new Set(linkedTargets(draft))

  return {
    ...proposal,
    links: proposal.links.filter(({ targetPath }) => !linked.has(targetPath)),
  }
}

// Problems the graph has on its own come first, since the engine would stop at the first of them.
const checkProposal = (
  loaded: Loaded,
  engine: Engine,
  draft: MappingGraph,
  proposal: AiProposal,
): Effect.Effect<string[]> => {
  const taken = new Set(linkedTargets(draft))
  const graphProblems = mappingGraphSchema.safeParse(proposal).error?.issues ?? []

  const unknown = unknownPaths(
    proposal,
    mappingSideLeaves(loaded.mapping.messageType, loaded.structure),
  )

  const problems = [
    ...graphProblems.map(({ message }) => message),
    ...[...unknown.source].map((path) => `The source has no field or element at ${path}`),
    ...[...unknown.target].map((path) => `The target has no field or element at ${path}`),
    ...proposal.links
      .filter(({ targetPath }) => taken.has(targetPath))
      .map(({ targetPath }) => `The Draft already links the target ${targetPath}`),
  ]

  if (problems.length > 0) {
    return Effect.succeed(problems)
  }

  return Effect.match(engine.run(withProposal(draft, proposal)), {
    onFailure: (error) => [engineMessages[error.code](error)],
    onSuccess: () => [],
  })
}

const instructions = [
  'You draft a Mapping for EDI Bridge: links that copy the value at a source path into a target path.',
  'Link only paths from the lists you are given, and each target at most once.',
  'Every required target needs a link. Use the tools to look up segment definitions and to run your links against the Sample Document before you answer.',
  'Answer with the links only; transforms are out of scope.',
].join('\n')

const fieldList = (fields: ReadonlyArray<{ path: string; required: boolean; name: string }>) =>
  fields
    .map(({ path, required, name }) => `- ${path}${required ? ' (required)' : ''}: ${name}`)
    .join('\n')

function task(loaded: Loaded, sampleId: string, draft: MappingGraph) {
  const { messageType } = loaded.mapping

  const { direction, source, target } = oriented(messageType, {
    document: documentStructureLeaves(loaded.structure),
    edifact: edifactLeaves(messageTypeStructures[messageType]).map((element) => ({
      ...element,
      name: element.name.en,
    })),
  })

  const sample = loaded.samples.find(({ id }) => id === sampleId)
  const linked = linkedTargets(draft).map((path) => `- ${path}`)

  return [
    `Draft an ${direction} Mapping for the Message Type ${messageType}.`,
    `Source paths:\n${fieldList(source)}`,
    `Target paths:\n${fieldList(target)}`,
    `Targets the Draft already links, which you leave out:\n${linked.join('\n') || '- none'}`,
    `Sample Document:\n${JSON.stringify(sample?.document.content)}`,
  ].join('\n\n')
}

// One round allows a few tool calls before the answer, which counts as a step of its own.
const stepsPerRound = 8

const segmentsOf = (nodes: ReadonlyArray<EdifactStructureNode>): EdifactSegment[] =>
  nodes.flatMap((node) => (node.kind === 'segment' ? [node] : segmentsOf(node.children)))

const describedElement = ({ path, name, required, format, codes }: EdifactElement) => ({
  path,
  name: name.en,
  required,
  format,
  codes: codes.map(({ code, meaning }) => `${code}: ${meaning.en}`),
})

const describedPart = (part: EdifactComposite | EdifactElement) =>
  part.kind === 'element'
    ? describedElement(part)
    : {
        path: part.path,
        name: part.name.en,
        required: part.required,
        elements: part.children.map(describedElement),
      }

const segmentDefinitions = (messageType: MessageType, segmentTags: ReadonlyArray<string>) =>
  segmentsOf(messageTypeStructures[messageType].children)
    .filter(({ tag }) => segmentTags.includes(tag))
    .map(({ path, name, required, maxRepeat, qualifier, children }) => ({
      path,
      name: name.en,
      required,
      maxRepeat,
      qualifier: qualifier?.code ?? null,
      parts: children.map(describedPart),
    }))

type Answer = { links: MappingLink[] } | { unreadable: string }

function answerProblems(text: string): string {
  let json: unknown

  try {
    json = JSON.parse(text)
  } catch {
    return 'it is no JSON'
  }

  return (aiLinkListSchema.safeParse(json).error?.issues ?? [])
    .map(({ path, message }) => `${path.join('.') || 'the answer'}: ${message}`)
    .join('; ')
}

const errorMessage = (errors: ReadonlyArray<string>): ModelMessage => ({
  role: 'user',
  content: `The check against the Sample Document found these errors; fix them:\n${errors
    .map((error) => `- ${error}`)
    .join('\n')}`,
})

export const draftMapping = ({ mappingId, sampleId, model, onStep, onTokens }: AiDraftRequest) =>
  Effect.gen(function* () {
    const loaded = yield* loadSamples(mappingId)
    const draft = loaded.mapping.draft
    const engine = yield* startEngine(loaded, sampleId, [draft])

    onStep({ kind: 'readingSample', round: 1 })

    const check = (proposal: AiProposal) => checkProposal(loaded, engine, draft, proposal)
    let round = 1

    const tools = {
      lookUpSegments: tool({
        description:
          'Look up the definitions of EDIFACT segments by tag, e.g. NAD: their paths, elements, formats and codes.',
        inputSchema: z.object({ segmentTags: z.array(z.string().min(1)).min(1) }),
        execute: ({ segmentTags }) => {
          onStep({ kind: 'lookingUpSegments', round, segmentTags })

          return segmentDefinitions(loaded.mapping.messageType, segmentTags)
        },
      }),
      checkLinks: tool({
        description:
          'Run links against the Sample Document with the mapping engine; answers the errors, none if the links pass.',
        inputSchema: aiLinkListSchema,
        execute: ({ links }) => Effect.runPromise(check(toProposal(links))),
      }),
    }

    const messages: ModelMessage[] = [{ role: 'user', content: task(loaded, sampleId, draft) }]
    let tokens = 0

    for (; ; round++) {
      const roundMessages: ModelMessage[] = []

      const answer = yield* Effect.tryPromise({
        // Interrupting the run aborts the call to the model.
        try: async (abortSignal): Promise<Answer> => {
          try {
            const result = await generateText({
              model,
              instructions,
              messages,
              tools,
              stopWhen: isStepCount(stepsPerRound),
              output: Output.object({ schema: aiLinkListSchema }),
              abortSignal,
              // The result and its errors carry the usage of the last step only.
              onStepEnd: ({ usage, response }) => {
                tokens += tokensOf(usage)
                onTokens?.(tokens)
                roundMessages.push(...response.messages)
              },
            })

            return { links: result.output.links }
          } catch (error) {
            if (NoObjectGeneratedError.isInstance(error)) {
              return {
                unreadable: `Your answer is no list of links: ${answerProblems(error.text ?? '')}`,
              }
            }

            if (NoOutputGeneratedError.isInstance(error)) {
              return {
                unreadable: `You reached the step limit of ${stepsPerRound} steps without answering with links`,
              }
            }

            throw error
          }
        },
        catch: () => new AiDraftFailed({ reason: 'unavailable', tokens }),
      })

      messages.push(...roundMessages)

      const proposal = toProposal('links' in answer ? answer.links : [])

      onStep({ kind: 'linksDrafted', round, linkCount: proposal.links.length })
      onStep({ kind: 'checkingAgainstSample', round })

      const errors = 'links' in answer ? yield* check(proposal) : [answer.unreadable]

      if (errors.length === 0) {
        return { proposal, graph: withProposal(draft, proposal), tokens }
      }

      if (round === aiDraftRounds) {
        return yield* new AiDraftFailed({ reason: 'checkFailed', tokens })
      }

      onStep({ kind: 'fixingErrors', round, errorCount: errors.length })
      messages.push(errorMessage(errors))
    }
  })
