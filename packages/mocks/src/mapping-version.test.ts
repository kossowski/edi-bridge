import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import {
  directionOf,
  mappingComparisonEndpoint,
  type MappingComparisonQuery,
  mappingDraftEndpoint,
  mappingVersionEndpoint,
  mappingVersionsEndpoint,
  publishMappingDraftEndpoint,
  saveMappingDraftEndpoint,
  toPath,
  toSearchParams,
  transformIssues,
} from '@edi-bridge/contracts'

import { seedDocumentStructures } from './document-structure'
import { seedMappings } from './flow'
import {
  createMappingDrafts,
  createMappingDraftStore,
  incompleteDraftId,
  mappingHandlers,
  type MappingDraftRecord,
  seedMappingDrafts,
} from './mapping'
import { seedMappingSamples } from './mapping-sample'
import {
  createMappingVersions,
  deriveMappingVersions,
  mappingDifferences,
  mappingVersionHandlers,
  seedMappingVersions,
  toMappingVersion,
} from './mapping-version'

const apiUrl = 'http://api.test'

const server = setupServer()

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))

afterEach(() => server.resetHandlers())

afterAll(() => server.close())

async function listVersions(mappingId: string) {
  const response = await fetch(`${apiUrl}${toPath(mappingVersionsEndpoint.path, { mappingId })}`)

  return mappingVersionsEndpoint.response.parse(await response.json())
}

async function publish(mappingId: string) {
  return fetch(`${apiUrl}${toPath(publishMappingDraftEndpoint.path, { mappingId })}`, {
    method: 'POST',
  })
}

async function compare(mappingId: string, query: MappingComparisonQuery) {
  const path = toPath(mappingComparisonEndpoint.path, { mappingId })

  return fetch(`${apiUrl}${path}?${toSearchParams(query)}`)
}

async function getDraft(id: string) {
  const response = await fetch(`${apiUrl}${toPath(mappingDraftEndpoint.path, { id })}`)

  return mappingDraftEndpoint.response.parse(await response.json())
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

    expect(version).toMatchObject({ ...older, direction: directionOf(published) })
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

  it('answers 404 for an unknown Mapping', async () => {
    handlers()

    expect((await publish(crypto.randomUUID())).status).toBe(404)
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
