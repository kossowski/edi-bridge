import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import {
  acceptAiDraftEndpoint,
  aiBudgetEndpoint,
  aiBudgetExhaustedProblemSchema,
  type AiDraftEvent,
  type MappingDraft,
  mappingDraftEndpoint,
  publishMappingDraftEndpoint,
  parseAiDraftEvent,
  type RequestAiDraftBody,
  requestAiDraftEndpoint,
  toPath,
} from '@edi-bridge/contracts'

import { aiDraftHandlers, type AiDraftOptions, aiDraftTokens } from './ai-draft'
import { seedDocumentStructures } from './document-structure'
import { createHandlers } from './index'
import {
  createMappingDraftStore,
  linkProblem,
  mappingHandlers,
  seedMappingDrafts,
  sideLeaves,
} from './mapping'
import { seedMappingSamples } from './mapping-sample'
import { mappingVersionHandlers } from './mapping-version'
import { showcaseViewerSession } from './session'
import { createWorkspaceSettings, createWorkspaceSettingsStore } from './workspace-settings'

const apiUrl = 'http://api.test'

const server = setupServer()

let streams: AbortController

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))

beforeEach(() => {
  streams = new AbortController()
})

afterEach(() => {
  streams.abort()
  server.resetHandlers()
})

afterAll(() => server.close())

const withoutLinks = seedMappingDrafts.find(
  ({ id, links, transforms }) =>
    links.length === 0 &&
    transforms.length === 0 &&
    seedMappingSamples.some(({ mappingId }) => mappingId === id),
)!

const outboundWithoutLinks = seedMappingDrafts.find(
  ({ id, links, messageType }) =>
    links.length === 0 &&
    ['DESADV', 'INVOIC'].includes(messageType) &&
    seedMappingSamples.some(({ mappingId }) => mappingId === id),
)!

const sampleOf = (mappingId: string) =>
  seedMappingSamples.find((sample) => sample.mappingId === mappingId)!

function use(options: AiDraftOptions = {}) {
  const mappings = createMappingDraftStore()

  server.use(
    ...mappingHandlers(apiUrl, { mappings }),
    ...mappingVersionHandlers(apiUrl, { mappings }),
    ...aiDraftHandlers(apiUrl, { mappings, stepDelayMs: 1, signal: streams.signal, ...options }),
  )

  return mappings
}

const withSamples = seedMappingDrafts.filter(({ id }) =>
  seedMappingSamples.some(({ mappingId }) => mappingId === id),
)

const halfDone = withSamples.find(
  ({ links, unpublishedChanges }) => links.length > 0 && unpublishedChanges,
)!

async function draftedEvent(mappingId: string) {
  const { events } = await readEvents(await requestAiDraft(mappingId))
  const last = events.at(-1)

  if (last?.type !== 'drafted') {
    throw new Error(`The AI draft ended with ${JSON.stringify(last)}`)
  }

  return last
}

function accept(mappingId: string) {
  return fetch(`${apiUrl}${toPath(acceptAiDraftEndpoint.path, { id: mappingId })}`, {
    method: 'POST',
  })
}

function getBudget() {
  return fetch(`${apiUrl}${aiBudgetEndpoint.path}`)
}

async function readBudget() {
  return aiBudgetEndpoint.response.parse(await (await getBudget()).json())
}

function partsOf(draft: MappingDraft) {
  const { links, transforms, transformLinks } = draft

  return { links, transforms, transformLinks }
}

function requestAiDraft(
  mappingId: string,
  body: Partial<RequestAiDraftBody> = { sampleId: sampleOf(mappingId).id },
) {
  return fetch(`${apiUrl}${toPath(requestAiDraftEndpoint.path, { id: mappingId })}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
    body: JSON.stringify(body),
  })
}

async function readEvents(response: Response, timeoutMs = 1000) {
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  const events: AiDraftEvent[] = []
  const deadline = Date.now() + timeoutMs
  let buffer = ''
  let ended = false

  while (Date.now() < deadline) {
    const result = await Promise.race([
      reader.read(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), deadline - Date.now())),
    ])

    if (result === null) {
      break
    }

    if (result.done) {
      ended = true
      break
    }

    buffer += decoder.decode(result.value, { stream: true })
    const blocks = buffer.split('\n\n')
    buffer = blocks.pop() ?? ''

    for (const block of blocks) {
      const data = block
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5))
        .join('\n')

      const event = data === '' ? null : parseAiDraftEvent(data)

      if (event) {
        events.push(event)
      }
    }
  }

  void reader.cancel().catch(() => {})

  return { events, ended }
}

async function getDraft(id: string) {
  const response = await fetch(`${apiUrl}${toPath(mappingDraftEndpoint.path, { id })}`)

  return mappingDraftEndpoint.response.parse(await response.json())
}

const stepsOf = (events: AiDraftEvent[]) =>
  events.flatMap((event) => (event.type === 'step' ? [event.step.kind] : []))

describe('POST /mappings/:id/ai-draft', () => {
  it('streams the progress steps and ends with the checked proposal in the Draft', async () => {
    use()

    const response = await requestAiDraft(withoutLinks.id)

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/event-stream')

    const { events, ended } = await readEvents(response)
    const last = events.at(-1)

    expect(ended).toBe(true)
    expect(stepsOf(events)).toEqual([
      'readingSample',
      'lookingUpSegments',
      'linksDrafted',
      'checkingAgainstSample',
      'fixingErrors',
      'linksDrafted',
      'checkingAgainstSample',
    ])
    expect(last?.type).toBe('drafted')

    if (last?.type !== 'drafted') {
      return
    }

    expect(last.proposal.links.length).toBeGreaterThan(0)
    expect(last.draft.aiReview).toMatchObject({ sampleId: sampleOf(withoutLinks.id).id })
    expect(last.draft.unpublishedChanges).toBe(true)
    await expect(getDraft(withoutLinks.id)).resolves.toEqual(last.draft)
  })
})

describe('POST /mappings/:id/ai-draft proposals', () => {
  it.each(withSamples.map((draft) => [draft.name, draft] as const))(
    'proposes links that exist on both sides for %s',
    async (_, draft) => {
      use()

      const { draft: drafted } = await draftedEvent(draft.id)

      expect(linkProblem(partsOf(drafted), sideLeaves(draft, seedDocumentStructures))).toBeNull()
    },
  )

  it('keeps the links of the Draft and proposes only for targets still free', async () => {
    use()

    const { proposal, draft } = await draftedEvent(halfDone.id)

    expect(draft.links).toEqual(expect.arrayContaining([...halfDone.links]))
    expect(proposal.links.map(({ targetPath }) => targetPath)).not.toEqual(
      expect.arrayContaining([halfDone.links[0]!.targetPath]),
    )
    expect(draft.aiReview?.proposedLinks).toEqual(
      proposal.links.map(({ targetPath }) => targetPath),
    )
  })

  it('proposes a Lookup Table transform where a code needs translating', async () => {
    use()

    const proposals = await Promise.all(
      withSamples.map(async ({ id }) => (await draftedEvent(id)).proposal),
    )

    expect(
      proposals.some(({ transforms }) =>
        transforms.some(
          (transform) => transform.kind === 'lookupTable' && transform.config.lookupTableId,
        ),
      ),
    ).toBe(true)
  })

  it('proposes many links in the large-volume state', async () => {
    use({ state: 'large' })

    const { proposal } = await draftedEvent(outboundWithoutLinks.id)

    expect(proposal.links.length).toBeGreaterThan(50)
  })

  it('proposes nothing in the empty state and leaves the Draft without a review', async () => {
    use({ state: 'empty' })

    const { events } = await readEvents(await requestAiDraft(withoutLinks.id))

    expect(stepsOf(events)).toEqual([
      'readingSample',
      'lookingUpSegments',
      'linksDrafted',
      'checkingAgainstSample',
    ])
    expect(events.at(-1)).toMatchObject({
      type: 'drafted',
      proposal: { links: [], transforms: [], transformLinks: [] },
      draft: { aiReview: null, links: [] },
    })
  })
})

describe('POST /mappings/:id/ai-draft states', () => {
  it('keeps the stream open after the first steps in the loading state', async () => {
    use({ state: 'loading' })

    const { events, ended } = await readEvents(await requestAiDraft(withoutLinks.id), 150)

    expect(stepsOf(events)).toEqual(['readingSample', 'lookingUpSegments'])
    expect(ended).toBe(false)
  })

  it('fails after rounds of fixing in the error state and leaves the Draft as it was', async () => {
    use({ state: 'error' })

    const { events, ended } = await readEvents(await requestAiDraft(withoutLinks.id))

    expect(ended).toBe(true)
    expect(stepsOf(events).filter((kind) => kind === 'fixingErrors')).toHaveLength(3)
    expect(events.at(-1)).toEqual({ type: 'failed', reason: 'checkFailed' })
    expect((await getDraft(withoutLinks.id)).aiReview).toBeNull()
  })

  it('fails mid-run once the budget runs out and leaves the budget used up', async () => {
    use({ state: 'budgetExhaustedMidRun' })

    const { events, ended } = await readEvents(await requestAiDraft(withoutLinks.id))

    expect(ended).toBe(true)
    expect(stepsOf(events)).toEqual([
      'readingSample',
      'lookingUpSegments',
      'linksDrafted',
      'checkingAgainstSample',
      'fixingErrors',
    ])
    expect(events.at(-1)).toEqual({ type: 'failed', reason: 'budgetExhausted' })
    expect((await getDraft(withoutLinks.id)).aiReview).toBeNull()

    const budget = await readBudget()

    expect(budget.usedToday).toBeGreaterThanOrEqual(budget.dailyLimit)
  })

  it('fails mid-run when the AI is unavailable and leaves the Draft as it was', async () => {
    use({ state: 'unavailable' })

    const { events, ended } = await readEvents(await requestAiDraft(withoutLinks.id))

    expect(ended).toBe(true)
    expect(stepsOf(events)).toEqual(['readingSample', 'lookingUpSegments'])
    expect(events.at(-1)).toEqual({ type: 'failed', reason: 'unavailable' })
    expect((await getDraft(withoutLinks.id)).aiReview).toBeNull()
  })

  it('rejects the request with the budget in the budget-exhausted state', async () => {
    use({ state: 'budgetExhausted' })

    const response = await requestAiDraft(withoutLinks.id)

    expect(response.status).toBe(429)
    expect(aiBudgetExhaustedProblemSchema.parse(await response.json()).budget).toMatchObject({
      usedToday: 200_000,
      dailyLimit: 200_000,
    })
  })

  it('stops streaming once stopped', async () => {
    use({ stepDelayMs: 20 })

    const response = await requestAiDraft(withoutLinks.id)
    streams.abort()
    const { ended } = await readEvents(response, 500)

    expect(ended).toBe(true)
    expect((await getDraft(withoutLinks.id)).aiReview).toBeNull()
  })
})

describe('POST /mappings/:id/ai-draft rejections', () => {
  it('answers 423 while an earlier AI review of the Draft is open', async () => {
    use()
    await draftedEvent(withoutLinks.id)

    expect((await requestAiDraft(withoutLinks.id)).status).toBe(423)
  })

  it('answers 404 for a Sample Document of another Mapping', async () => {
    use()
    const other = withSamples.find(({ id }) => id !== withoutLinks.id)!

    const response = await requestAiDraft(withoutLinks.id, { sampleId: sampleOf(other.id).id })

    expect(response.status).toBe(404)
  })

  it('answers 404 for an unknown Mapping', async () => {
    use()

    const response = await requestAiDraft(crypto.randomUUID(), { sampleId: crypto.randomUUID() })

    expect(response.status).toBe(404)
  })

  it('answers 400 without a Sample Document', async () => {
    use()

    expect((await requestAiDraft(withoutLinks.id, {})).status).toBe(400)
  })

  it('answers 403 to a Viewer on every AI endpoint', async () => {
    use({ session: showcaseViewerSession })

    expect((await requestAiDraft(withoutLinks.id)).status).toBe(403)
    expect((await getBudget()).status).toBe(403)
    expect((await accept(withoutLinks.id)).status).toBe(403)
  })
})

describe('GET /workspaces/current/ai-budget', () => {
  it('tells the daily budget and when it resets', async () => {
    use({
      settings: createWorkspaceSettings({ aiTokenBudget: { dailyLimit: 100_000, usedToday: 0 } }),
    })

    const response = await getBudget()
    const budget = aiBudgetEndpoint.response.parse(await response.json())

    expect(response.status).toBe(200)
    expect(budget).toMatchObject({ dailyLimit: 100_000, usedToday: 0 })
    expect(Date.parse(budget.resetsAt)).toBeGreaterThan(Date.now())
  })

  it('counts the tokens of each AI draft against the budget', async () => {
    const settings = createWorkspaceSettingsStore(
      createWorkspaceSettings({ aiTokenBudget: { dailyLimit: 100_000, usedToday: 0 } }),
    )

    use({ settings })

    await draftedEvent(withoutLinks.id)

    expect((await readBudget()).usedToday).toBe(aiDraftTokens)
  })

  it('tells a used-up budget in the budget-exhausted state', async () => {
    use({ state: 'budgetExhausted' })

    const budget = await readBudget()

    expect(budget.usedToday).toBeGreaterThanOrEqual(budget.dailyLimit)
  })
})

describe('POST /mappings/:id/ai-draft/accept', () => {
  it('ends the review, keeps the proposed links and lets the Draft be published', async () => {
    use()
    const { draft } = await draftedEvent(withoutLinks.id)

    expect(
      (
        await fetch(
          `${apiUrl}${toPath(publishMappingDraftEndpoint.path, { mappingId: draft.mappingId })}`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ changeNote: '' }),
          },
        )
      ).status,
    ).toBe(423)

    const response = await accept(withoutLinks.id)
    const accepted = acceptAiDraftEndpoint.response.parse(await response.json())

    expect(accepted.aiReview).toBeNull()
    expect(partsOf(accepted)).toEqual(partsOf(draft))
    await expect(getDraft(withoutLinks.id)).resolves.toEqual(accepted)
    expect(
      (
        await fetch(
          `${apiUrl}${toPath(publishMappingDraftEndpoint.path, { mappingId: draft.mappingId })}`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ changeNote: '' }),
          },
        )
      ).status,
    ).toBe(201)
  })

  it('answers 409 for a Draft without an open AI review', async () => {
    use()

    expect((await accept(withoutLinks.id)).status).toBe(409)
  })
})

describe('createHandlers AI draft', () => {
  it('serves the AI draft in the state asked for', async () => {
    server.use(...createHandlers(apiUrl, { aiDraft: { state: 'budgetExhausted' } }))

    expect((await requestAiDraft(withoutLinks.id)).status).toBe(429)
  })

  it('streams an AI draft into the Draft the canvas reads', async () => {
    server.use(...createHandlers(apiUrl, { aiDraft: { stepDelayMs: 1, signal: streams.signal } }))

    const { draft } = await draftedEvent(withoutLinks.id)

    await expect(getDraft(withoutLinks.id)).resolves.toEqual(draft)
  })
})
