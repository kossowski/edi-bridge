import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import {
  aiReviewOpenStatus,
  directionOf,
  flowEndpoint,
  mappingComparisonEndpoint,
  type MappingComparisonQuery,
  mappingDifferences,
  mappingDraftEndpoint,
  mappingSideLeaves,
  mappingVersionEndpoint,
  mappingVersionsEndpoint,
  type PublishMappingDraftBody,
  publishMappingDraftEndpoint,
  restoreMappingVersionEndpoint,
  saveMappingDraftEndpoint,
  toPath,
  toSearchParams,
  transformIssues,
} from '@edi-bridge/contracts'

import { seedDocumentStructures } from './document-structure'
import { createFlows, createFlowStore, flowHandlers, seedFlows, seedMappings } from './flow'
import {
  createMappingDrafts,
  createMappingDraftStore,
  incompleteDraftId,
  mappingHandlers,
  type MappingDraftRecord,
  seedMappingDrafts,
  structureOf,
} from './mapping'
import { seedMappingSamples } from './mapping-sample'
import {
  createMappingVersions,
  createMappingVersionStore,
  deriveMappingVersions,
  mappingVersionHandlers,
  seedMappingVersions,
  toMappingVersion,
} from './mapping-version'
import { publishDraft } from './publish-request'
import { seedSession } from './session'

const apiUrl = 'http://api.test'

const server = setupServer()

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))

afterEach(() => server.resetHandlers())

afterAll(() => server.close())

async function listVersions(mappingId: string) {
  const response = await fetch(`${apiUrl}${toPath(mappingVersionsEndpoint.path, { mappingId })}`)

  return mappingVersionsEndpoint.response.parse(await response.json())
}

function publish(mappingId: string, body?: Partial<PublishMappingDraftBody>) {
  return publishDraft(apiUrl, mappingId, body)
}

async function getFlow(id: string) {
  const response = await fetch(`${apiUrl}${toPath(flowEndpoint.path, { id })}`)

  return flowEndpoint.response.parse(await response.json())
}

async function compare(mappingId: string, query: MappingComparisonQuery) {
  const path = toPath(mappingComparisonEndpoint.path, { mappingId })

  return fetch(`${apiUrl}${path}?${toSearchParams(query)}`)
}

async function getDraft(id: string) {
  const response = await fetch(`${apiUrl}${toPath(mappingDraftEndpoint.path, { id })}`)

  return mappingDraftEndpoint.response.parse(await response.json())
}

function saveDraft(
  id: string,
  graph: Pick<MappingDraftRecord, 'links' | 'transforms' | 'transformLinks'>,
) {
  return fetch(`${apiUrl}${toPath(saveMappingDraftEndpoint.path, { id })}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(graph),
  })
}

const reviewSampleId = '00000008-0000-4000-8000-000000000001'

// The review proposes the first link of the Draft.
function inAiReview(draft: MappingDraftRecord): MappingDraftRecord {
  return {
    ...draft,
    aiReview: {
      sampleId: reviewSampleId,
      proposedLinks: [draft.links[0]!.targetPath],
      proposedTransforms: [],
      proposedTransformLinks: [],
    },
  }
}

// A source path that no link or transform link of the Draft uses.
function unlinkedSourcePath(draft: MappingDraftRecord) {
  const { source } = mappingSideLeaves(
    draft.messageType,
    structureOf(draft, seedDocumentStructures),
  )

  const linked = new Set([
    ...draft.links.map(({ sourcePath }) => sourcePath),
    ...draft.transformLinks.flatMap(({ from }) => (from.kind === 'source' ? [from.path] : [])),
  ])

  return [...source].find((path) => !linked.has(path))!
}

// Each save leaves no AI review mark, so it closes the review that inAiReview opens.
const closingSaves = [
  {
    closedBy: 'rejects',
    links: ({ links }: MappingDraftRecord) => links.slice(1),
  },
  {
    closedBy: 'edits',
    links: (draft: MappingDraftRecord) => [
      { ...draft.links[0]!, sourcePath: unlinkedSourcePath(draft) },
      ...draft.links.slice(1),
    ],
  },
]

function closingSave(
  draft: MappingDraftRecord,
  links: (draft: MappingDraftRecord) => MappingDraftRecord['links'],
) {
  const { transforms, transformLinks } = draft

  return saveDraft(draft.id, { links: links(draft), transforms, transformLinks })
}

const hasEarlierConfig = ({ transforms }: MappingDraftRecord) =>
  transforms.some(({ kind }) => kind === 'substring')

const published = seedMappingDrafts.find(
  (draft) =>
    !draft.unpublishedChanges && (draft.latestVersion ?? 0) >= 2 && hasEarlierConfig(draft),
)!

const changed = seedMappingDrafts.find(
  (draft) => draft.unpublishedChanges && draft.latestVersion !== null,
)!

const neverPublished = seedMappingDrafts.find(({ latestVersion }) => latestVersion === null)!

describe('seed Mapping Versions', () => {
  it('are valid versions of their Draft', () => {
    for (const version of seedMappingVersions) {
      const draft = seedMappingDrafts.find(({ id }) => id === version.mappingId)!

      expect(() => toMappingVersion(version, draft, seedDocumentStructures)).not.toThrow()
    }
  })

  it('keep the versions that Flows and Runs pin', () => {
    for (const { mappingId, versions } of seedMappings) {
      const ids = seedMappingVersions
        .filter((version) => version.mappingId === mappingId)
        .map(({ id }) => id)

      expect(new Set(ids)).toEqual(new Set(versions.map(({ id }) => id)))
    }
  })

  it('match the Draft in the latest version unless the Draft has unpublished changes', () => {
    for (const draft of seedMappingDrafts.filter(({ latestVersion }) => latestVersion !== null)) {
      const [latest] = deriveMappingVersions(draft)
      const differences = mappingDifferences(latest!, draft)

      if (draft.unpublishedChanges && draft.links.length > 0) {
        expect(differences).not.toHaveLength(0)
      } else if (!draft.unpublishedChanges) {
        expect(differences).toHaveLength(0)
      }
    }
  })
})

describe('GET /mappings/:mappingId/versions', () => {
  it('lists the versions of a Mapping, newest first', async () => {
    server.use(...mappingVersionHandlers(apiUrl))
    const versions = await listVersions(published.id)

    expect(versions.map(({ version }) => version)).toEqual(
      Array.from(
        { length: published.latestVersion! },
        (_, index) => published.latestVersion! - index,
      ),
    )
  })

  it('lists no versions for a Draft that was never published', async () => {
    server.use(...mappingVersionHandlers(apiUrl))

    expect(await listVersions(neverPublished.id)).toEqual([])
  })

  it('answers 404 for an unknown Mapping', async () => {
    server.use(...mappingVersionHandlers(apiUrl))
    const path = toPath(mappingVersionsEndpoint.path, { mappingId: crypto.randomUUID() })

    expect((await fetch(`${apiUrl}${path}`)).status).toBe(404)
  })

  it('lists a long history for a large volume of versions', async () => {
    const [draft] = createMappingDrafts({ count: 1 })
    const long = { ...draft!, latestVersion: 120 }
    server.use(...mappingVersionHandlers(apiUrl, { mappings: [long] }))

    expect(await listVersions(long.id)).toHaveLength(120)
  })
})

describe('GET /mappings/:mappingId/versions history', () => {
  const pinnedVersionIds = new Set(seedFlows.map(({ mappingVersionId }) => mappingVersionId))

  const pinnedMapping = seedMappingDrafts.find(({ id }) =>
    seedMappingVersions.some(
      (version) => version.mappingId === id && pinnedVersionIds.has(version.id),
    ),
  )!

  it('names the Flows pinned to each version with their Trading Partner', async () => {
    server.use(...mappingVersionHandlers(apiUrl))
    const versions = await listVersions(pinnedMapping.id)

    for (const version of versions) {
      const expected = seedFlows.filter(({ mappingVersionId }) => mappingVersionId === version.id)

      expect(version.flows.map(({ id }) => id).sort()).toEqual(expected.map(({ id }) => id).sort())

      for (const flow of version.flows) {
        const record = expected.find(({ id }) => id === flow.id)!
        expect(flow.tradingPartner.id).toBe(record.tradingPartnerId)
      }
    }

    expect(versions.some(({ flows }) => flows.length > 0)).toBe(true)
  })

  it('shows change notes for newer versions and none for old ones, with who published', async () => {
    server.use(...mappingVersionHandlers(apiUrl))
    const all = (await Promise.all(seedMappingDrafts.map(({ id }) => listVersions(id)))).flat()

    expect(all.some(({ changeNote }) => changeNote === null)).toBe(true)
    expect(all.some(({ changeNote }) => changeNote !== null)).toBe(true)
    expect(new Set(all.map(({ publishedBy }) => publishedBy.name)).size).toBeGreaterThan(1)
  })

  it('lists every Flow of a large volume pinned to one version', async () => {
    const flows = createFlows({ count: 300 })
    server.use(...mappingVersionHandlers(apiUrl, { flows }))
    const [version] = await listVersions(pinnedMapping.id)

    const expected = flows.filter(({ mappingVersionId }) => mappingVersionId === version!.id)

    expect(version!.flows).toHaveLength(expected.length)
  })
})

describe('GET /mappings/:mappingId/versions/:versionId', () => {
  it('returns the graph of a version', async () => {
    server.use(...mappingVersionHandlers(apiUrl))
    const [, older] = await listVersions(published.id)

    const path = toPath(mappingVersionEndpoint.path, {
      mappingId: published.id,
      versionId: older!.id,
    })

    const version = mappingVersionEndpoint.response.parse(
      await (await fetch(`${apiUrl}${path}`)).json(),
    )

    const { id, mappingId, mappingName, version: number, publishedAt } = older!

    expect(version).toMatchObject({
      id,
      mappingId,
      mappingName,
      version: number,
      publishedAt,
      direction: directionOf(published),
    })
    expect(version.links.length).toBeLessThan(published.links.length)
  })

  it('answers 404 for a version of another Mapping', async () => {
    server.use(...mappingVersionHandlers(apiUrl))
    const [other] = await listVersions(changed.id)

    const path = toPath(mappingVersionEndpoint.path, {
      mappingId: published.id,
      versionId: other!.id,
    })

    expect((await fetch(`${apiUrl}${path}`)).status).toBe(404)
  })
})

describe('POST /mappings/:mappingId/versions', () => {
  function handlers() {
    const mappings = createMappingDraftStore()

    server.use(
      ...mappingHandlers(apiUrl, { mappings }),
      ...mappingVersionHandlers(apiUrl, { mappings }),
    )
  }

  const publishable = seedMappingDrafts.filter(
    (draft) =>
      draft.unpublishedChanges &&
      Object.values(transformIssues(draft)).every((issues) => issues.length === 0),
  )

  it('publishes a Draft that was never published as version 1', async () => {
    handlers()
    const response = await publish(neverPublished.id)

    expect(response.status).toBe(201)
    expect(publishMappingDraftEndpoint.response.parse(await response.json())).toMatchObject({
      mappingId: neverPublished.id,
      version: 1,
    })
    expect(await getDraft(neverPublished.id)).toMatchObject({
      latestVersion: 1,
      unpublishedChanges: false,
    })
  })

  it('adds the new version to the top of the list', async () => {
    handlers()
    const draft = publishable.find(({ latestVersion }) => latestVersion !== null)!

    const created = publishMappingDraftEndpoint.response.parse(
      await (await publish(draft.id)).json(),
    )

    const [newest] = await listVersions(draft.id)

    expect(newest).toEqual(created)
    expect(created.version).toBe(draft.latestVersion! + 1)
  })

  it('answers 409 when the Draft has no changes since its latest version', async () => {
    handlers()

    expect((await publish(published.id)).status).toBe(409)
  })

  it('publishes again once a saved change makes the Draft differ', async () => {
    handlers()

    const draft = seedMappingDrafts.find(
      ({ unpublishedChanges, transforms }) => !unpublishedChanges && transforms.length === 0,
    )!

    await fetch(`${apiUrl}${toPath(saveMappingDraftEndpoint.path, { id: draft.id })}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ links: [], transforms: [], transformLinks: [] }),
    })

    expect((await getDraft(draft.id)).unpublishedChanges).toBe(true)
    expect((await publish(draft.id)).status).toBe(201)
  })

  it('answers 422 for a Draft with an invalid transform', async () => {
    handlers()

    expect((await publish(incompleteDraftId)).status).toBe(422)
  })

  it('publishes every seed Draft with unpublished changes but the incomplete one', async () => {
    handlers()

    const changedDrafts = seedMappingDrafts.filter(({ unpublishedChanges }) => unpublishedChanges)

    const statuses = await Promise.all(
      changedDrafts.map(async ({ id }) => [id, (await publish(id)).status] as const),
    )

    expect(Object.fromEntries(statuses)).toEqual(
      Object.fromEntries(changedDrafts.map(({ id }) => [id, id === incompleteDraftId ? 422 : 201])),
    )
  })

  it('answers 423 while the AI review of the Draft is open', async () => {
    const reviewing = inAiReview(publishable.find(({ links }) => links.length > 0)!)

    server.use(
      ...mappingVersionHandlers(apiUrl, { mappings: createMappingDraftStore([reviewing]) }),
    )

    expect((await publish(reviewing.id)).status).toBe(aiReviewOpenStatus)
    expect(aiReviewOpenStatus).toBe(423)
  })

  it.each(closingSaves)(
    'publishes once a save $closedBy the last proposed part of the AI review',
    async ({ links }) => {
      const reviewing = inAiReview(publishable.find(({ links }) => links.length > 0)!)
      const mappings = createMappingDraftStore([reviewing])

      server.use(
        ...mappingHandlers(apiUrl, { mappings }),
        ...mappingVersionHandlers(apiUrl, { mappings }),
      )

      expect((await closingSave(reviewing, links)).status).toBe(200)
      expect((await publish(reviewing.id)).status).toBe(201)
    },
  )

  it('answers 404 for an unknown Mapping', async () => {
    handlers()

    expect((await publish(crypto.randomUUID())).status).toBe(404)
  })

  it('answers 400 without a change note', async () => {
    handlers()
    const draft = publishable.find(({ latestVersion }) => latestVersion !== null)!

    expect((await publish(draft.id, {})).status).toBe(400)
  })
})

describe('POST /mappings/:mappingId/versions with a change note and Flows to move', () => {
  const flowsOf = (mappingId: string) =>
    seedFlows.filter((flow) =>
      seedMappingVersions.some(
        (version) => version.mappingId === mappingId && version.id === flow.mappingVersionId,
      ),
    )

  const draft = seedMappingDrafts.find(
    ({ id, unpublishedChanges }) =>
      unpublishedChanges && id !== incompleteDraftId && flowsOf(id).length >= 2,
  )!

  const [moved, staying] = flowsOf(draft.id)

  function handlers() {
    const mappings = createMappingDraftStore()
    const versions = createMappingVersionStore()
    const flows = createFlowStore()

    server.use(
      ...mappingVersionHandlers(apiUrl, { mappings, versions, flows }),
      ...flowHandlers(apiUrl, { flows, mappings: versions }),
    )
  }

  it('stores the change note and who published it', async () => {
    handlers()

    const response = await publish(draft.id, { changeNote: '  Delivery date added  ' })
    const created = publishMappingDraftEndpoint.response.parse(await response.json())

    expect(created).toMatchObject({
      changeNote: 'Delivery date added',
      publishedBy: { id: seedSession.user.id, name: seedSession.user.name },
    })
    expect((await listVersions(draft.id))[0]).toEqual(created)
  })

  it('keeps an empty change note as none', async () => {
    handlers()

    const created = publishMappingDraftEndpoint.response.parse(
      await (await publish(draft.id, { changeNote: '   ' })).json(),
    )

    expect(created.changeNote).toBeNull()
  })

  it('moves no Flow unless chosen', async () => {
    handlers()
    const before = await getFlow(moved!.id)

    const created = publishMappingDraftEndpoint.response.parse(
      await (await publish(draft.id, { changeNote: 'Delivery date added' })).json(),
    )

    expect(created.flows).toEqual([])
    expect((await getFlow(moved!.id)).mappingVersion.id).toBe(before.mappingVersion.id)
  })

  it('moves only the chosen Flows to the new version', async () => {
    handlers()
    const before = await getFlow(staying!.id)

    const created = publishMappingDraftEndpoint.response.parse(
      await (
        await publish(draft.id, { changeNote: 'Unit codes', moveFlowIds: [moved!.id] })
      ).json(),
    )

    expect(created.flows.map(({ id }) => id)).toEqual([moved!.id])
    expect((await getFlow(moved!.id)).mappingVersion.id).toBe(created.id)
    expect((await getFlow(staying!.id)).mappingVersion.id).toBe(before.mappingVersion.id)
  })

  it('answers 422 and publishes nothing for a Flow of another Mapping', async () => {
    handlers()
    const foreign = seedFlows.find((flow) => ![moved!.id, staying!.id].includes(flow.id))!
    const before = await listVersions(draft.id)

    const response = await publish(draft.id, { changeNote: '', moveFlowIds: [foreign.id] })

    expect(response.status).toBe(422)
    expect(await listVersions(draft.id)).toEqual(before)
  })
})

describe('POST /mappings/:mappingId/versions/:versionId/restore', () => {
  function handlers(mappings = createMappingDraftStore()) {
    server.use(
      ...mappingHandlers(apiUrl, { mappings }),
      ...mappingVersionHandlers(apiUrl, { mappings }),
    )
  }

  async function restore(mappingId: string, versionId: string) {
    const path = toPath(restoreMappingVersionEndpoint.path, { mappingId, versionId })

    return fetch(`${apiUrl}${path}`, { method: 'POST' })
  }

  it('copies the graph of an older version into the Draft, which differs from the latest', async () => {
    handlers()
    const [, older] = await listVersions(published.id)

    const response = await restore(published.id, older!.id)
    const restored = restoreMappingVersionEndpoint.response.parse(await response.json())

    const versionPath = toPath(mappingVersionEndpoint.path, {
      mappingId: published.id,
      versionId: older!.id,
    })

    const version = mappingVersionEndpoint.response.parse(
      await (await fetch(`${apiUrl}${versionPath}`)).json(),
    )

    expect(response.status).toBe(200)
    expect(restored).toMatchObject({
      links: version.links,
      transforms: version.transforms,
      transformLinks: version.transformLinks,
      unpublishedChanges: true,
      latestVersion: published.latestVersion,
    })
    expect(await getDraft(published.id)).toEqual(restored)
  })

  it('leaves no unpublished changes after restoring the latest version', async () => {
    handlers()
    const [latest] = await listVersions(changed.id)

    const restored = restoreMappingVersionEndpoint.response.parse(
      await (await restore(changed.id, latest!.id)).json(),
    )

    expect(restored.unpublishedChanges).toBe(false)
  })

  it('answers 404 for a version of another Mapping', async () => {
    handlers()
    const [foreign] = await listVersions(changed.id)

    expect((await restore(published.id, foreign!.id)).status).toBe(404)
  })

  it('answers 423 while the AI review of the Draft is open', async () => {
    const reviewing = inAiReview(published)

    handlers(createMappingDraftStore([reviewing]))
    const [, older] = await listVersions(reviewing.id)

    expect((await restore(reviewing.id, older!.id)).status).toBe(aiReviewOpenStatus)
  })

  it.each(closingSaves)(
    'restores once a save $closedBy the last proposed part of the AI review',
    async ({ links }) => {
      const reviewing = inAiReview(published)

      handlers(createMappingDraftStore([reviewing]))
      const [, older] = await listVersions(reviewing.id)

      expect((await closingSave(reviewing, links)).status).toBe(200)
      expect((await restore(reviewing.id, older!.id)).status).toBe(200)
    },
  )

  it('answers 404 for an unknown version while the AI review of the Draft is open', async () => {
    const reviewing = inAiReview(published)

    handlers(createMappingDraftStore([reviewing]))

    expect((await restore(reviewing.id, crypto.randomUUID())).status).toBe(404)
  })
})

describe('GET /mappings/:mappingId/comparison', () => {
  const sample = seedMappingSamples.find(({ mappingId }) => mappingId === published.id)!

  async function oldestAndLatest() {
    const versions = await listVersions(published.id)

    return { from: versions.at(-1)!.id, to: versions[0]!.id }
  }

  it('lists added, removed and changed links, transforms and transform links', async () => {
    server.use(...mappingVersionHandlers(apiUrl))
    const response = await compare(published.id, await oldestAndLatest())
    const comparison = mappingComparisonEndpoint.response.parse(await response.json())

    const kinds = new Set(comparison.differences.map(({ kind, change }) => `${kind}:${change}`))

    expect(kinds).toEqual(
      new Set([
        'link:added',
        'link:changed',
        'transform:added',
        'transform:changed',
        'transformLink:added',
      ]),
    )
    expect(comparison.outputs).toBeNull()
  })

  it('shows both outputs and their differences for the same Sample Document', async () => {
    server.use(...mappingVersionHandlers(apiUrl))

    const response = await compare(published.id, {
      ...(await oldestAndLatest()),
      sampleId: sample.id,
    })

    const { outputs } = mappingComparisonEndpoint.response.parse(await response.json())

    expect(outputs?.sampleId).toBe(sample.id)
    expect(outputs?.from.document).not.toEqual(outputs?.to.document)
    expect(outputs?.differences.length).toBeGreaterThan(0)
  })

  it('lists no differences between versions with the same graph', async () => {
    const [draft] = createMappingDrafts({ count: 1 })
    const empty = { ...draft!, links: [], transforms: [], transformLinks: [], latestVersion: 2 }
    server.use(...mappingVersionHandlers(apiUrl, { mappings: [empty] }))
    const [to, from] = await listVersions(empty.id)

    const response = await compare(empty.id, { from: from!.id, to: to!.id })

    expect(mappingComparisonEndpoint.response.parse(await response.json()).differences).toEqual([])
  })

  it('answers 400 when both sides are the same version', async () => {
    server.use(...mappingVersionHandlers(apiUrl))
    const { to } = await oldestAndLatest()

    expect((await compare(published.id, { from: to, to })).status).toBe(400)
  })

  it('answers 404 for a version or Sample Document of another Mapping', async () => {
    server.use(...mappingVersionHandlers(apiUrl))
    const versions = await oldestAndLatest()
    const [foreign] = await listVersions(changed.id)
    const foreignSample = seedMappingSamples.find(({ mappingId }) => mappingId === changed.id)!

    expect((await compare(published.id, { ...versions, to: foreign!.id })).status).toBe(404)
    expect((await compare(published.id, { ...versions, sampleId: foreignSample.id })).status).toBe(
      404,
    )
  })
})

describe('mapping version states', () => {
  it('answers 500 for the history, publishing and restoring in the error state', async () => {
    server.use(...mappingVersionHandlers(apiUrl, { versions: 'error' }))
    const [version] = seedMappingVersions.filter(({ mappingId }) => mappingId === published.id)

    const restorePath = toPath(restoreMappingVersionEndpoint.path, {
      mappingId: published.id,
      versionId: version!.id,
    })

    expect(
      (await fetch(`${apiUrl}${toPath(mappingVersionsEndpoint.path, { mappingId: published.id })}`))
        .status,
    ).toBe(500)
    expect((await publish(changed.id)).status).toBe(500)
    expect((await fetch(`${apiUrl}${restorePath}`, { method: 'POST' })).status).toBe(500)
  })

  it('never answers the history in the loading state', async () => {
    server.use(...mappingVersionHandlers(apiUrl, { versions: 'loading' }))
    const path = toPath(mappingVersionsEndpoint.path, { mappingId: published.id })

    const answer = await Promise.race([
      fetch(`${apiUrl}${path}`).then(() => 'answered'),
      new Promise((resolve) => setTimeout(() => resolve('pending'), 50)),
    ])

    expect(answer).toBe('pending')
  })
})

describe('createMappingVersions', () => {
  it('derives the versions of a large volume of Drafts', () => {
    const drafts = createMappingDrafts({ count: 200, documentStructures: seedDocumentStructures })
    const versions = createMappingVersions(drafts)

    expect(versions).toHaveLength(
      drafts.reduce((sum, { latestVersion }) => sum + (latestVersion ?? 0), 0),
    )

    for (const version of versions) {
      const draft = drafts.find(({ id }) => id === version.mappingId)!

      expect(() => toMappingVersion(version, draft, seedDocumentStructures)).not.toThrow()
    }
  })
})
