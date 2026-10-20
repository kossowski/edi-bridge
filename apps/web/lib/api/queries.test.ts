import {
  focusManager,
  MutationObserver,
  onlineManager,
  QueryClient,
  QueryObserver,
} from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import { lookupTableSuggestionsEndpoint, type Task } from '@edi-bridge/contracts'
import {
  aiDraftHandlers,
  aiProposalFor,
  createTradingPartner,
  publishedVersionsOf,
  seedDocumentStructures,
  seedLookupTables,
  seedMappingDrafts,
  seedMappingSamples,
  seedTradingPartners,
  toLookupTable,
  toMappingDraft,
  toMappingSummary,
  withAiProposal,
} from '@edi-bridge/mocks'

import { retriesQuery } from './client'
import { apiUrl } from './config'
import {
  acceptAiProposedPartsMutation,
  documentStructureQuery,
  documentStructuresQuery,
  forgetDeletedLookupTable,
  graphChangeScope,
  lookupTableMissingCodeHintsQuery,
  lookupTableMissingCodesQuery,
  lookupTableQuery,
  lookupTablesQuery,
  lookupTableSuggestionsQuery,
  mappingDraftQuery,
  mappingKeys,
  mappingsQuery,
  mappingVersionsQuery,
  newestTasksFirst,
  storeCreatedMapping,
  storePublishedMappingVersion,
  storeSavedDocumentStructure,
  storeSavedLookupTable,
  storeSavedTradingPartner,
  tradingPartnerQuery,
  tradingPartnersQuery,
} from './queries'

describe('storeSavedTradingPartner', () => {
  it('caches the saved Trading Partner and marks the list as stale', () => {
    const queryClient = new QueryClient()
    const saved = createTradingPartner()
    queryClient.setQueryData(tradingPartnersQuery.queryKey, [])

    storeSavedTradingPartner(queryClient, saved)

    expect(queryClient.getQueryData(tradingPartnerQuery(saved.id).queryKey)).toEqual(saved)
    expect(queryClient.getQueryState(tradingPartnersQuery.queryKey)?.isInvalidated).toBe(true)
  })
})

describe('storeCreatedMapping', () => {
  it('adds the created Mapping to the list by name and marks the list as stale', () => {
    const queryClient = new QueryClient()

    const [a, b, c] = seedMappingDrafts
      .slice(0, 3)
      .map((record) =>
        toMappingSummary(record, seedDocumentStructures, {
          facts: { partners: [], documentsLast7Days: 0, failedRunsLast7Days: 0 },
          versions: publishedVersionsOf(record),
        }),
      )
      .sort((x, y) => x.name.localeCompare(y.name, 'de'))

    queryClient.setQueryData(mappingsQuery.queryKey, [a!, c!])

    storeCreatedMapping(queryClient, b!)

    expect(queryClient.getQueryData(mappingsQuery.queryKey)).toEqual([a, b, c])
    expect(queryClient.getQueryState(mappingsQuery.queryKey)?.isInvalidated).toBe(true)
  })
})

describe('storePublishedMappingVersion', () => {
  it('marks the Draft as published and the version list as stale', () => {
    const queryClient = new QueryClient()

    const record = seedMappingDrafts.find(
      ({ unpublishedChanges, latestVersion }) => unpublishedChanges && latestVersion !== null,
    )!

    const draft = toMappingDraft(record, seedDocumentStructures)

    queryClient.setQueryData(mappingDraftQuery(draft.mappingId).queryKey, draft)
    queryClient.setQueryData(mappingVersionsQuery(draft.mappingId).queryKey, [])

    storePublishedMappingVersion(queryClient, {
      id: crypto.randomUUID(),
      mappingId: draft.mappingId,
      mappingName: draft.name,
      version: draft.latestVersion! + 1,
      publishedAt: new Date().toISOString(),
    })

    expect(queryClient.getQueryData(mappingDraftQuery(draft.mappingId).queryKey)).toMatchObject({
      latestVersion: draft.latestVersion! + 1,
      unpublishedChanges: false,
    })
    expect(
      queryClient.getQueryState(mappingVersionsQuery(draft.mappingId).queryKey)?.isInvalidated,
    ).toBe(true)
  })
})

describe('storeSavedDocumentStructure', () => {
  it('caches the saved Document Structure and marks the list as stale', () => {
    const queryClient = new QueryClient()
    const [saved] = seedDocumentStructures
    queryClient.setQueryData(documentStructuresQuery.queryKey, [])

    storeSavedDocumentStructure(queryClient, saved!)

    expect(queryClient.getQueryData(documentStructureQuery(saved!.id).queryKey)).toEqual(saved)
    expect(queryClient.getQueryState(documentStructuresQuery.queryKey)?.isInvalidated).toBe(true)
  })
})

describe('lookupTableQuery', () => {
  it('keys a Lookup Table by the language of its code meanings', () => {
    const id = seedLookupTables[0]!.id

    expect(lookupTableQuery(id, 'de').queryKey).not.toEqual(lookupTableQuery(id, 'en').queryKey)
    expect(lookupTableMissingCodesQuery(id, 'de').queryKey).not.toEqual(
      lookupTableMissingCodesQuery(id, 'en').queryKey,
    )
  })
})

describe('storeSavedLookupTable', () => {
  const saved = toLookupTable(seedLookupTables[0]!, {
    get: (id) => seedTradingPartners.find((tradingPartner) => tradingPartner.id === id),
  })

  it('caches the saved Lookup Table and marks its missing codes as stale', () => {
    const queryClient = new QueryClient()

    queryClient.setQueryData(lookupTableMissingCodesQuery(saved.id, 'en').queryKey, [])
    queryClient.setQueryData(lookupTableMissingCodesQuery(saved.id, 'de').queryKey, [])

    storeSavedLookupTable(queryClient, saved)

    expect(queryClient.getQueryData(lookupTableQuery(saved.id, 'en').queryKey)).toEqual(saved)

    for (const language of ['en', 'de'] as const) {
      expect(
        queryClient.getQueryState(lookupTableMissingCodesQuery(saved.id, language).queryKey)
          ?.isInvalidated,
      ).toBe(true)
    }
  })

  it('keeps the AI hints of its missing codes, since each fetch spends AI budget', () => {
    const queryClient = new QueryClient()
    const hints = lookupTableMissingCodeHintsQuery(saved.id, 'en').queryKey

    queryClient.setQueryData(hints, { hints: [], notice: null })

    storeSavedLookupTable(queryClient, saved)

    expect(queryClient.getQueryState(hints)?.isInvalidated).toBe(false)
  })

  it('keeps the German code meanings until the German Lookup Table is read again', () => {
    const queryClient = new QueryClient()
    const germanMeanings = [{ code: 'PCE', meaning: 'Stück' }]
    const german = lookupTableQuery(saved.id, 'de').queryKey

    queryClient.setQueryData(german, { ...saved, entries: [], codeMeanings: germanMeanings })

    storeSavedLookupTable(queryClient, saved)

    expect(queryClient.getQueryData(german)).toEqual({ ...saved, codeMeanings: germanMeanings })
    expect(queryClient.getQueryState(german)?.isInvalidated).toBe(true)
  })
})

describe('forgetDeletedLookupTable', () => {
  it('drops the deleted Lookup Table and marks the list as stale', () => {
    const queryClient = new QueryClient()

    const tradingPartners = {
      get: (id: string) => seedTradingPartners.find((tradingPartner) => tradingPartner.id === id),
    }

    const [deleted, kept] = seedLookupTables.map((table) => toLookupTable(table, tradingPartners))

    queryClient.setQueryData(lookupTablesQuery.queryKey, [deleted!, kept!])
    queryClient.setQueryData(lookupTableQuery(deleted!.id, 'de').queryKey, deleted)
    queryClient.setQueryData(lookupTableMissingCodeHintsQuery(deleted!.id, 'de').queryKey, {
      hints: [],
      notice: null,
    })

    forgetDeletedLookupTable(queryClient, deleted!.id)

    expect(
      queryClient.getQueryState(lookupTableMissingCodeHintsQuery(deleted!.id, 'de').queryKey),
    ).toBeUndefined()

    expect(queryClient.getQueryState(lookupTableQuery(deleted!.id, 'de').queryKey)).toBeUndefined()
    expect(queryClient.getQueryData(lookupTablesQuery.queryKey)).toEqual([kept])
    expect(queryClient.getQueryState(lookupTablesQuery.queryKey)?.isInvalidated).toBe(true)
  })
})

describe('lookupTableSuggestionsQuery', () => {
  it('keys the suggestions by kind, Trading Partner and language', () => {
    const units = lookupTableSuggestionsQuery({ kind: 'units', language: 'en' })

    const hansemarktUnits = lookupTableSuggestionsQuery({
      kind: 'units',
      tradingPartnerId: seedTradingPartners[0]!.id,
      language: 'en',
    })

    expect(lookupTableSuggestionsQuery({ kind: 'units', language: 'en' }).queryKey).toEqual(
      units.queryKey,
    )
    expect(hansemarktUnits.queryKey).not.toEqual(units.queryKey)
    expect(lookupTableSuggestionsQuery({ kind: 'countries', language: 'en' }).queryKey).not.toEqual(
      units.queryKey,
    )
    expect(lookupTableSuggestionsQuery({ kind: 'units', language: 'de' }).queryKey).not.toEqual(
      units.queryKey,
    )
  })

  it('never fetches the suggestions again on its own, since each fetch spends AI budget', () => {
    const units = lookupTableSuggestionsQuery({ kind: 'units', language: 'en' })

    expect(units).toMatchObject({ staleTime: Infinity, gcTime: Infinity, retry: false })
  })

  describe('when the AI budget is used up', () => {
    const server = setupServer()

    beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))

    afterEach(() => {
      server.resetHandlers()
      server.events.removeAllListeners()
      focusManager.setFocused(undefined)
      onlineManager.setOnline(true)
    })

    afterAll(() => server.close())

    it('fetches the suggestions once, also after a remount, a focus or a reconnect', async () => {
      let requests = 0
      server.use(
        http.get(`${apiUrl}${lookupTableSuggestionsEndpoint.path}`, () =>
          HttpResponse.json({ message: 'AI budget used up for today' }, { status: 429 }),
        ),
      )
      server.events.on('request:start', () => requests++)

      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: retriesQuery } } })
      const units = lookupTableSuggestionsQuery({ kind: 'units', language: 'en' })
      const mounted = new QueryObserver(queryClient, units)
      const unmount = mounted.subscribe(() => {})
      await expect.poll(() => mounted.getCurrentResult().status).toBe('error')
      unmount()

      const remounted = new QueryObserver(queryClient, units)
      remounted.subscribe(() => {})
      focusManager.setFocused(false)
      focusManager.setFocused(true)
      onlineManager.setOnline(false)
      onlineManager.setOnline(true)
      await new Promise((resolve) => setTimeout(resolve, 20))

      expect(requests).toBe(1)
      expect(remounted.getCurrentResult().status).toBe('error')
    })
  })
})

describe('lookupTableMissingCodeHintsQuery', () => {
  it('keys the hints by Lookup Table and language', () => {
    const id = seedLookupTables[0]!.id

    expect(lookupTableMissingCodeHintsQuery(id, 'de').queryKey).not.toEqual(
      lookupTableMissingCodeHintsQuery(id, 'en').queryKey,
    )
    expect(lookupTableMissingCodeHintsQuery(id, 'en').queryKey).not.toEqual(
      lookupTableMissingCodesQuery(id, 'en').queryKey,
    )
  })

  it('never asks for the hints again on its own, since each fetch spends AI budget', () => {
    const hints = lookupTableMissingCodeHintsQuery(seedLookupTables[0]!.id, 'en')

    expect(hints).toMatchObject({
      staleTime: Infinity,
      gcTime: Infinity,
      retry: false,
      retryOnMount: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    })
  })
})

describe('newestTasksFirst', () => {
  function partnerTask(id: string, at: string): Task {
    return {
      id,
      kind: 'failingTradingPartner',
      whoActs: 'you',
      tradingPartner: { id: '10000000-0000-4000-8000-000000000001', name: 'Hansemarkt GmbH' },
      at,
      delivered: 1,
      failed: 4,
      target: { kind: 'tradingPartner', tradingPartnerId: '10000000-0000-4000-8000-000000000001' },
    }
  }

  it('orders the tasks by time, newest first, and keeps the counts', () => {
    const counts = { you: 3, retry: 0, tradingPartner: 0 }

    const sorted = newestTasksFirst({
      counts,
      tasks: [
        partnerTask('older', '2026-10-10T08:00:00Z'),
        partnerTask('newest', '2026-10-11T09:30:00.000Z'),
        partnerTask('middle', '2026-10-11T08:00:00Z'),
      ],
    })

    expect(sorted.tasks.map((task) => task.id)).toEqual(['newest', 'middle', 'older'])
    expect(sorted.counts).toBe(counts)
  })
})

describe('acceptAiProposedPartsMutation', () => {
  const server = setupServer()

  beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))

  afterEach(() => server.resetHandlers())

  afterAll(() => server.close())

  const record = seedMappingDrafts.find(
    ({ id, links }) =>
      links.length === 0 && seedMappingSamples.some(({ mappingId }) => mappingId === id),
  )!

  const sample = seedMappingSamples.find(({ mappingId }) => mappingId === record.id)!
  const reviewed = withAiProposal(record, sample.id, aiProposalFor(record, seedDocumentStructures))
  const review = reviewed.aiReview!

  it('caches the Draft and closes its AI review once nothing proposed is left', async () => {
    server.use(...aiDraftHandlers(apiUrl, { mappings: [reviewed] }))

    const queryClient = new QueryClient()
    const { queryKey } = mappingDraftQuery(reviewed.id)

    queryClient.setQueryData(queryKey, toMappingDraft(reviewed, seedDocumentStructures))

    await new MutationObserver(
      queryClient,
      acceptAiProposedPartsMutation(queryClient, reviewed.id),
    ).mutate({
      links: review.proposedLinks,
      transforms: review.proposedTransforms,
      transformLinks: review.proposedTransformLinks,
    })

    expect(queryClient.getQueryData(queryKey)).toMatchObject({ aiReview: null })
  })

  const firstLink = { links: review.proposedLinks.slice(0, 1), transforms: [], transformLinks: [] }

  function graphSave(queryClient: QueryClient, mutationFn: () => Promise<void>) {
    return new MutationObserver(queryClient, {
      mutationKey: mappingKeys.graph(reviewed.id),
      scope: graphChangeScope(reviewed.id),
      mutationFn,
    }).mutate()
  }

  it('waits for the graph save before it to settle', async () => {
    server.use(...aiDraftHandlers(apiUrl, { mappings: [reviewed] }))

    const queryClient = new QueryClient()
    const order: string[] = []
    const { promise: saving, resolve: finishSave } = Promise.withResolvers<void>()

    queryClient.setQueryData(
      mappingDraftQuery(reviewed.id).queryKey,
      toMappingDraft(reviewed, seedDocumentStructures),
    )
    server.events.on('request:start', () => order.push('accept sent'))

    const saved = graphSave(queryClient, () => saving).then(() => order.push('save settled'))

    const accepted = new MutationObserver(
      queryClient,
      acceptAiProposedPartsMutation(queryClient, reviewed.id),
    ).mutate(firstLink)

    await new Promise((resolve) => setTimeout(resolve, 20))
    finishSave()
    await Promise.all([saved, accepted])
    server.events.removeAllListeners()

    expect(order).toEqual(['save settled', 'accept sent'])
  })

  it('keeps the change of a save waiting behind it and takes only the review', async () => {
    server.use(...aiDraftHandlers(apiUrl, { mappings: [reviewed] }))

    const queryClient = new QueryClient()
    const { queryKey } = mappingDraftQuery(reviewed.id)
    const draft = toMappingDraft(reviewed, seedDocumentStructures)
    const added = { sourcePath: 'note', targetPath: 'FTX/4440' }
    const { promise: saving, resolve: finishSave } = Promise.withResolvers<void>()

    queryClient.setQueryData(queryKey, draft)

    const accepted = new MutationObserver(
      queryClient,
      acceptAiProposedPartsMutation(queryClient, reviewed.id),
    ).mutate(firstLink)

    queryClient.setQueryData(queryKey, { ...draft, links: [...draft.links, added] })

    const saved = graphSave(queryClient, () => saving)

    await accepted

    expect(queryClient.getQueryData(queryKey)).toMatchObject({
      links: [...draft.links, added],
      aiReview: { proposedLinks: review.proposedLinks.slice(1) },
    })

    finishSave()
    await saved
  })
})
