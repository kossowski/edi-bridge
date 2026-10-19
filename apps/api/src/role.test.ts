import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { z } from 'zod'

import type { InjectOptions } from 'fastify'

import {
  acceptAiDraftEndpoint,
  acceptAiProposedPartsEndpoint,
  acceptInviteEndpoint,
  channelEndpoint,
  channelsEndpoint,
  createChannelEndpoint,
  createDocumentStructureEndpoint,
  createFlowEndpoint,
  createInviteEndpoint,
  createLookupTableEndpoint,
  createMappingEndpoint,
  createTradingPartnerEndpoint,
  currentWorkspaceEndpoint,
  deleteLookupTableEndpoint,
  documentStructureEndpoint,
  documentStructureOrigins,
  type FlowInput,
  documentStructuresEndpoint,
  flowEndpoint,
  flowsEndpoint,
  importLookupTableEndpoint,
  inferDocumentStructureEndpoint,
  lookupTableEndpoint,
  lookupTableImportPreviewEndpoint,
  lookupTableMissingCodesEndpoint,
  lookupTableSuggestionsEndpoint,
  lookupTablesEndpoint,
  mappingComparisonEndpoint,
  mappingDraftEndpoint,
  mappingSamplesEndpoint,
  mappingVersionEndpoint,
  mappingVersionsEndpoint,
  mappingsEndpoint,
  messageTypeStructureEndpoint,
  moveFlowMappingVersionEndpoint,
  publishedMappingVersionsEndpoint,
  publishMappingDraftEndpoint,
  regenerateWebhookTokenEndpoint,
  removeWorkspaceMemberEndpoint,
  restoreMappingVersionEndpoint,
  revokeInviteEndpoint,
  runsEndpoint,
  saveMappingDraftEndpoint,
  sessionEndpoint,
  submitDocumentEndpoint,
  tradingPartnerActivitiesEndpoint,
  tradingPartnerActivityEndpoint,
  tradingPartnerEndpoint,
  tradingPartnerSchema,
  testChannelEndpoint,
  toPath,
  tradingPartnersEndpoint,
  updateChannelEndpoint,
  updateCompanyIdentityEndpoint,
  updateDocumentStructureEndpoint,
  updateFlowEndpoint,
  updateLookupTableEndpoint,
  updateTradingPartnerEndpoint,
  withCheckDigit,
  workspaceMembersEndpoint,
} from '@edi-bridge/contracts'

import { buildApp, readsWithBody } from './app.js'
import {
  addMember,
  type Client,
  type NewMember,
  ownWorkspace,
  signIn,
  startTestApi,
  type TestApi,
  testAuth,
  testChannels,
  testRunQueue,
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

const channel = {
  type: 'webhook',
  direction: 'inbound',
  name: 'ERP webhook',
  tradingPartnerId: null,
  rateLimitPerMinute: 60,
}

const destination = {
  type: 'http',
  direction: 'outbound',
  name: 'ERP HTTP delivery',
  tradingPartnerId: null,
  url: 'https://erp.nordwind-handel.example/api/edi/documents',
  authorization: null,
}

const inboxOf = (tradingPartnerId: string) => ({
  type: 'sftp',
  direction: 'inbound',
  name: 'Hansemarkt SFTP inbox',
  tradingPartnerId,
  host: 'sftp.hansemarkt.example',
  port: 22,
  username: 'nordwind',
  remotePath: '/outbox',
  authentication: 'password',
  pollingIntervalMinutes: 5,
  credential: 'sftp-password-4711',
})

const documentStructure = { name: 'ERP orders', origin: documentStructureOrigins.jsonDocument }

interface Ids {
  tradingPartner: string
  channel: string
  lookupTable: string
  documentStructure: string
  mapping: string
  mappingVersion: string
  laterMappingVersion: string
  flow: string
}

let api: TestApi

let operator: Client

let ids: Ids

let flowInput: FlowInput

const withId = (path: string, id: string) => path.replace(':id', id)

const createdSchema = z.object({ id: z.uuid() })

const createdChannelIdSchema = z.object({ channel: createdSchema })

async function createdId(url: string, body: NonNullable<InjectOptions['body']>) {
  const response = await api.admin.inject({ method: 'POST', url, body })

  expect(response.statusCode).toBe(201)

  return createdSchema.parse(response.json()).id
}

async function createdChannelId(body: NonNullable<InjectOptions['body']> = channel) {
  const response = await api.admin.inject({
    method: 'POST',
    url: createChannelEndpoint.path,
    body,
  })

  expect(response.statusCode).toBe(201)

  return createdChannelIdSchema.parse(response.json()).channel.id
}

beforeAll(async () => {
  api = await startTestApi()
  await addMember(api.connection.db, operatorAsViewer)
  operator = await signIn(api.app, operatorAsViewer)

  const documentStructureId = await createdId(
    createDocumentStructureEndpoint.path,
    documentStructure,
  )

  const mapping = await createdId(createMappingEndpoint.path, { messageType: 'ORDERS' })
  const versionsPath = toPath(publishMappingDraftEndpoint.path, { mappingId: mapping })
  const mappingVersion = await createdId(versionsPath, { changeNote: '' })

  const saved = await api.admin.inject({
    method: 'PUT',
    url: withId(saveMappingDraftEndpoint.path, mapping),
    body: {
      links: [{ sourcePath: 'BGM/1004', targetPath: 'orderNumber' }],
      transforms: [],
      transformLinks: [],
    },
  })

  expect(saved.statusCode).toBe(200)

  const tradingPartnerId = await createdId(createTradingPartnerEndpoint.path, tradingPartner)

  flowInput = {
    name: 'Hansemarkt ORDERS inbound',
    tradingPartnerId,
    messageType: 'ORDERS',
    inboundChannelId: await createdChannelId(inboxOf(tradingPartnerId)),
    destinationChannelId: await createdChannelId(destination),
    mappingVersionId: mappingVersion,
  }

  ids = {
    tradingPartner: tradingPartnerId,
    channel: await createdChannelId(),
    lookupTable: await createdId(createLookupTableEndpoint.path, lookupTable),
    documentStructure: documentStructureId,
    mapping,
    mappingVersion,
    laterMappingVersion: await createdId(versionsPath, { changeNote: '' }),
    flow: await createdId(createFlowEndpoint.path, flowInput),
  }
}, 60_000)

afterAll(async () => {
  await api.stop()
})

const workspaceReads = (): string[] => [
  currentWorkspaceEndpoint.path,
  tradingPartnersEndpoint.path,
  tradingPartnerActivitiesEndpoint.path,
  withId(tradingPartnerEndpoint.path, ids.tradingPartner),
  withId(tradingPartnerActivityEndpoint.path, ids.tradingPartner),
  channelsEndpoint.path,
  withId(channelEndpoint.path, ids.channel),
  flowsEndpoint.path,
  withId(flowEndpoint.path, ids.flow),
  lookupTablesEndpoint.path,
  `${lookupTableSuggestionsEndpoint.path}?kind=units`,
  withId(lookupTableEndpoint.path, ids.lookupTable),
  withId(lookupTableMissingCodesEndpoint.path, ids.lookupTable),
  documentStructuresEndpoint.path,
  withId(documentStructureEndpoint.path, ids.documentStructure),
  toPath(messageTypeStructureEndpoint.path, { messageType: 'INVOIC' }),
  mappingsEndpoint.path,
  withId(mappingDraftEndpoint.path, ids.mapping),
  withId(mappingSamplesEndpoint.path, ids.mapping),
  toPath(mappingVersionsEndpoint.path, { mappingId: ids.mapping }),
  toPath(mappingVersionEndpoint.path, { mappingId: ids.mapping, versionId: ids.mappingVersion }),
  `${toPath(mappingComparisonEndpoint.path, { mappingId: ids.mapping })}?from=${ids.mappingVersion}&to=${ids.laterMappingVersion}`,
  publishedMappingVersionsEndpoint.path,
  runsEndpoint.path,
]

const reads = () => [sessionEndpoint.path, workspaceMembersEndpoint.path, ...workspaceReads()]

const changes: [string, () => InjectOptions & { url: string }][] = [
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
  ['create a Channel', () => ({ method: 'POST', url: createChannelEndpoint.path, body: channel })],
  [
    'update a Channel',
    () => ({
      method: 'PUT',
      url: withId(updateChannelEndpoint.path, ids.channel),
      body: { ...channel, name: 'ERP orders webhook' },
    }),
  ],
  [
    'regenerate a webhook token',
    () => ({ method: 'POST', url: withId(regenerateWebhookTokenEndpoint.path, ids.channel) }),
  ],
  [
    'test a Channel',
    () => ({ method: 'POST', url: withId(testChannelEndpoint.path, ids.channel) }),
  ],
  ['create a Flow', () => ({ method: 'POST', url: createFlowEndpoint.path, body: flowInput })],
  [
    'update a Flow',
    () => ({
      method: 'PUT',
      url: withId(updateFlowEndpoint.path, ids.flow),
      body: { ...flowInput, name: 'Hansemarkt orders' },
    }),
  ],
  [
    'move a Flow to a newer Mapping Version',
    () => ({
      method: 'POST',
      url: withId(moveFlowMappingVersionEndpoint.path, ids.flow),
      body: { mappingVersionId: ids.laterMappingVersion },
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
  [
    'create a Mapping',
    () => ({ method: 'POST', url: createMappingEndpoint.path, body: { messageType: 'DESADV' } }),
  ],
  [
    'save the Draft of a Mapping',
    () => ({
      method: 'PUT',
      url: withId(saveMappingDraftEndpoint.path, ids.mapping),
      body: {
        links: [{ sourcePath: 'BGM/1004', targetPath: 'orderNumber' }],
        transforms: [],
        transformLinks: [],
      },
    }),
  ],
  [
    'publish the Draft of a Mapping',
    () => ({
      method: 'POST',
      url: toPath(publishMappingDraftEndpoint.path, { mappingId: ids.mapping }),
      body: { changeNote: 'Order number mapped' },
    }),
  ],
  [
    'restore a Mapping Version into the Draft',
    () => ({
      method: 'POST',
      url: toPath(restoreMappingVersionEndpoint.path, {
        mappingId: ids.mapping,
        versionId: ids.mappingVersion,
      }),
    }),
  ],
  [
    'accept the AI draft',
    () => ({ method: 'POST', url: toPath(acceptAiDraftEndpoint.path, { id: ids.mapping }) }),
  ],
  [
    'accept AI-proposed parts',
    () => ({
      method: 'POST',
      url: toPath(acceptAiProposedPartsEndpoint.path, { id: ids.mapping }),
      body: { links: ['orderNumber'], transforms: [], transformLinks: [] },
    }),
  ],
  [
    'submit a Document',
    () => ({
      method: 'POST',
      url: submitDocumentEndpoint.path,
      body: { channelId: ids.channel, document: { fileName: 'invoice.json', content: '{}' } },
    }),
  ],
  [
    'create an invite',
    () => ({
      method: 'POST',
      url: toPath(createInviteEndpoint.path, { workspaceId: ownWorkspace.id }),
      body: { email: 'invited@nordwind.example', role: 'admin' },
    }),
  ],
  [
    'revoke an invite',
    () => ({
      method: 'DELETE',
      url: toPath(revokeInviteEndpoint.path, {
        workspaceId: ownWorkspace.id,
        inviteId: '5d0f3c1e-8a4b-4e6f-9b2d-1c7a3e5f9d08',
      }),
    }),
  ],
  [
    'remove a Member',
    () => ({
      method: 'DELETE',
      url: toPath(removeWorkspaceMemberEndpoint.path, {
        workspaceId: ownWorkspace.id,
        userId: '2b7e4c9a-1d3f-4a68-b5e0-9c8d7f6a5b43',
      }),
    }),
  ],
]

const publicChanges = new Set<string>([acceptInviteEndpoint.path])

const snapshot = async (target: Client) =>
  Promise.all(
    workspaceReads().map(async (url) =>
      (await target.inject({ method: 'GET', url })).json<unknown>(),
    ),
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

describe('the changes', () => {
  it('cover every changing route', async () => {
    const registered: { method: string; url: string }[] = []

    const app = buildApp({
      auth: testAuth,
      channels: testChannels,
      database: api.connection.db,
      probes: { postgres: () => Promise.resolve(), redis: () => Promise.resolve() },
      runQueue: testRunQueue().service,
    })

    app.addHook('onRoute', ({ method, url }) => {
      registered.push(...[method].flat().map((one) => ({ method: one, url })))
    })
    await app.ready()
    await app.close()

    const matches = (url: string, path: string) =>
      new RegExp(`^${url.replaceAll(/:[^/]+/g, '[^/]+')}$`).test(path)

    const uncovered = registered
      .filter(
        ({ method, url }) =>
          !['GET', 'HEAD', 'OPTIONS'].includes(method) &&
          !url.startsWith('/auth/') &&
          !publicChanges.has(url) &&
          !readsWithBody.has(url),
      )
      .filter(({ method, url }) =>
        changes.every(([, request]) => {
          const change = request()

          return change.method !== method || !matches(url, change.url)
        }),
      )

    expect(registered).not.toEqual([])
    expect(uncovered).toEqual([])
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
