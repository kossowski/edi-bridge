import { MutationObserver, QueryClient } from '@tanstack/react-query'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import { type Task } from '@edi-bridge/contracts'
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

import { apiUrl } from './config'
import {
  acceptAiProposedPartsMutation,
  documentStructureQuery,
  documentStructuresQuery,
  forgetDeletedLookupTable,
  lookupTableMissingCodesQuery,
  lookupTableQuery,
  lookupTablesQuery,
  lookupTableSuggestionsQuery,
  mappingDraftQuery,
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

describe('storeSavedLookupTable', () => {
  it('caches the saved Lookup Table and marks its missing codes as stale', () => {
    const queryClient = new QueryClient()

    const saved = toLookupTable(seedLookupTables[0]!, {
      get: (id) => seedTradingPartners.find((tradingPartner) => tradingPartner.id === id),
    })

    queryClient.setQueryData(lookupTableMissingCodesQuery(saved.id).queryKey, [])

    storeSavedLookupTable(queryClient, saved)

    expect(queryClient.getQueryData(lookupTableQuery(saved.id).queryKey)).toEqual(saved)
    expect(
      queryClient.getQueryState(lookupTableMissingCodesQuery(saved.id).queryKey)?.isInvalidated,
    ).toBe(true)
  })
})

describe('forgetDeletedLookupTable', () => {
  it('drops the deleted Lookup Table and marks the list as stale', () => {
    const queryClient = new QueryClient()

    const deleted = toLookupTable(seedLookupTables[0]!, {
      get: (id) => seedTradingPartners.find((tradingPartner) => tradingPartner.id === id),
    })

    queryClient.setQueryData(lookupTablesQuery.queryKey, [])
    queryClient.setQueryData(lookupTableQuery(deleted.id).queryKey, deleted)

    forgetDeletedLookupTable(queryClient, deleted.id)

    expect(queryClient.getQueryState(lookupTableQuery(deleted.id).queryKey)).toBeUndefined()
    expect(queryClient.getQueryState(lookupTablesQuery.queryKey)?.isInvalidated).toBe(true)
  })
})

describe('lookupTableSuggestionsQuery', () => {
  it('keys the suggestions by kind and Trading Partner and keeps them fresh', () => {
    const units = lookupTableSuggestionsQuery({ kind: 'units' })

    const hansemarktUnits = lookupTableSuggestionsQuery({
      kind: 'units',
      tradingPartnerId: seedTradingPartners[0]!.id,
    })

    expect(lookupTableSuggestionsQuery({ kind: 'units' }).queryKey).toEqual(units.queryKey)
    expect(hansemarktUnits.queryKey).not.toEqual(units.queryKey)
    expect(lookupTableSuggestionsQuery({ kind: 'countries' }).queryKey).not.toEqual(units.queryKey)
    expect(units.staleTime).toBe(Infinity)
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
})
