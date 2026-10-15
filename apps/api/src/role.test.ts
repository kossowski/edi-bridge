import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { z } from 'zod'

import type { InjectOptions } from 'fastify'

import {
  channelsEndpoint,
  createDocumentStructureEndpoint,
  createLookupTableEndpoint,
  createTradingPartnerEndpoint,
  currentWorkspaceEndpoint,
  deleteLookupTableEndpoint,
  documentStructureEndpoint,
  documentStructureOrigins,
  documentStructuresEndpoint,
  importLookupTableEndpoint,
  inferDocumentStructureEndpoint,
  lookupTableEndpoint,
  lookupTableImportPreviewEndpoint,
  lookupTableMissingCodesEndpoint,
  lookupTableSuggestionsEndpoint,
  lookupTablesEndpoint,
  sessionEndpoint,
  tradingPartnerActivitiesEndpoint,
  tradingPartnerActivityEndpoint,
  tradingPartnerEndpoint,
  tradingPartnerSchema,
  tradingPartnersEndpoint,
  updateCompanyIdentityEndpoint,
  updateDocumentStructureEndpoint,
  updateLookupTableEndpoint,
  updateTradingPartnerEndpoint,
  withCheckDigit,
} from '@edi-bridge/contracts'

import {
  addMember,
  type Client,
  type NewMember,
  ownWorkspace,
  signIn,
  startTestApi,
  type TestApi,
} from './testing.js'

const operatorAsViewer: NewMember = {
  name: 'Platform Operator',
  email: 'operator@platform.example',
  password: 'operator-password',
  workspaceId: ownWorkspace.id,
  role: 'viewer',
  operator: true,
}

const tradingPartner = {
  name: 'Hansemarkt GmbH',
  gln: withCheckDigit('400000000001'),
  characterSet: 'UNOC',
  acknowledgementTimeLimitHours: 24,
}

const lookupTable = {
  name: 'Mengeneinheiten',
  kind: 'units',
  scope: { kind: 'workspace' },
  entries: [{ sourceCode: 'ST', targetCode: 'PCE' }],
}

const documentStructure = { name: 'ERP orders', origin: documentStructureOrigins.jsonDocument }

interface Ids {
  tradingPartner: string
  lookupTable: string
  documentStructure: string
}

let api: TestApi

let operator: Client

let ids: Ids

const withId = (path: string, id: string) => path.replace(':id', id)

const createdSchema = z.object({ id: z.uuid() })

async function createdId(url: string, body: NonNullable<InjectOptions['body']>) {
  const response = await api.admin.inject({ method: 'POST', url, body })

  expect(response.statusCode).toBe(201)

  return createdSchema.parse(response.json()).id
}

beforeAll(async () => {
  api = await startTestApi()
  await addMember(api.connection.db, operatorAsViewer)
  operator = await signIn(api.app, operatorAsViewer)

  ids = {
    tradingPartner: await createdId(createTradingPartnerEndpoint.path, tradingPartner),
    lookupTable: await createdId(createLookupTableEndpoint.path, lookupTable),
    documentStructure: await createdId(createDocumentStructureEndpoint.path, documentStructure),
  }
}, 60_000)

afterAll(async () => {
  await api.stop()
})

const reads = (): string[] => [
  sessionEndpoint.path,
  currentWorkspaceEndpoint.path,
  tradingPartnersEndpoint.path,
  tradingPartnerActivitiesEndpoint.path,
  withId(tradingPartnerEndpoint.path, ids.tradingPartner),
  withId(tradingPartnerActivityEndpoint.path, ids.tradingPartner),
  channelsEndpoint.path,
  lookupTablesEndpoint.path,
  `${lookupTableSuggestionsEndpoint.path}?kind=units`,
  withId(lookupTableEndpoint.path, ids.lookupTable),
  withId(lookupTableMissingCodesEndpoint.path, ids.lookupTable),
  documentStructuresEndpoint.path,
  withId(documentStructureEndpoint.path, ids.documentStructure),
]

const changes: [string, () => InjectOptions][] = [
  [
    'update the company identity',
    () => ({
      method: 'PUT',
      url: updateCompanyIdentityEndpoint.path,
      body: { gln: withCheckDigit('021234500000') },
    }),
  ],
  [
    'create a Trading Partner',
    () => ({ method: 'POST', url: createTradingPartnerEndpoint.path, body: tradingPartner }),
  ],
  [
    'update a Trading Partner',
    () => ({
      method: 'PUT',
      url: withId(updateTradingPartnerEndpoint.path, ids.tradingPartner),
      body: { ...tradingPartner, name: 'Hansemarkt AG' },
    }),
  ],
  [
    'create a Lookup Table',
    () => ({ method: 'POST', url: createLookupTableEndpoint.path, body: lookupTable }),
  ],
  [
    'update a Lookup Table',
    () => ({
      method: 'PUT',
      url: withId(updateLookupTableEndpoint.path, ids.lookupTable),
      body: { ...lookupTable, name: 'Einheiten' },
    }),
  ],
  [
    'delete a Lookup Table',
    () => ({ method: 'DELETE', url: withId(deleteLookupTableEndpoint.path, ids.lookupTable) }),
  ],
  [
    'preview a Lookup Table import',
    () => ({
      method: 'POST',
      url: withId(lookupTableImportPreviewEndpoint.path, ids.lookupTable),
      body: { csv: 'KAR;CT\n' },
    }),
  ],
  [
    'import a CSV into a Lookup Table',
    () => ({
      method: 'POST',
      url: withId(importLookupTableEndpoint.path, ids.lookupTable),
      body: { csv: 'KAR;CT\n' },
    }),
  ],
  [
    'infer a Document Structure',
    () => ({
      method: 'POST',
      url: inferDocumentStructureEndpoint.path,
      body: documentStructureOrigins.jsonDocument,
    }),
  ],
  [
    'create a Document Structure',
    () => ({ method: 'POST', url: createDocumentStructureEndpoint.path, body: documentStructure }),
  ],
  [
    'adjust a Document Structure',
    () => ({
      method: 'PUT',
      url: withId(updateDocumentStructureEndpoint.path, ids.documentStructure),
      body: { name: 'ERP purchase orders', adjustments: [] },
    }),
  ],
]

const snapshot = async (target: Client) =>
  Promise.all(
    reads()
      .filter((url) => url !== sessionEndpoint.path)
      .map(async (url) => (await target.inject({ method: 'GET', url })).json<unknown>()),
  )

describe('a Viewer', () => {
  it('reads everything in the Workspace', async () => {
    const statuses = await Promise.all(
      reads().map(async (url) => [
        url,
        (await api.viewer.inject({ method: 'GET', url })).statusCode,
      ]),
    )

    expect(statuses).toEqual(reads().map((url) => [url, 200]))
  })

  it.each(changes)('answers 403 and changes nothing to %s', async (_, request) => {
    const before = await snapshot(api.admin)

    const response = await api.viewer.inject(request())

    expect(response.statusCode).toBe(403)
    expect(response.json()).toEqual({ message: 'Forbidden' })
    expect(await snapshot(api.admin)).toEqual(before)
  })

  it('answers 403 before it validates the body', async () => {
    const response = await api.viewer.inject({
      method: 'POST',
      url: createTradingPartnerEndpoint.path,
      body: { name: '' },
    })

    expect(response.statusCode).toBe(403)
  })
})

describe('the Operator', () => {
  it('changes a Workspace where it is a Viewer', async () => {
    const response = await operator.inject({
      method: 'PUT',
      url: withId(updateTradingPartnerEndpoint.path, ids.tradingPartner),
      body: { ...tradingPartner, name: 'Hansemarkt Operator GmbH' },
    })

    expect(response.statusCode).toBe(200)
    expect(tradingPartnerSchema.parse(response.json()).name).toBe('Hansemarkt Operator GmbH')
  })
})
