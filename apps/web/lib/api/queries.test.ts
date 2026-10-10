import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'

import {
  createTradingPartner,
  seedDocumentStructures,
  seedMappingDrafts,
  toMappingDraft,
} from '@edi-bridge/mocks'

import {
  documentStructureQuery,
  documentStructuresQuery,
  mappingDraftQuery,
  mappingVersionsQuery,
  storePublishedMappingVersion,
  storeSavedDocumentStructure,
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
