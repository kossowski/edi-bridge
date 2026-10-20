import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import {
  acceptInviteEndpoint,
  aiBudgetExhaustedProblemSchema,
  aiBudgetExhaustedStatus,
  type ChannelInput,
  createInviteEndpoint,
  inviteSchema,
  channelsEndpoint,
  createChannelEndpoint,
  createFlowEndpoint,
  createDocumentStructureEndpoint,
  createLookupTableEndpoint,
  createMappingEndpoint,
  createTradingPartnerEndpoint,
  currentWorkspaceEndpoint,
  documentStructureEndpoint,
  documentStructureOrigins,
  documentStructuresEndpoint,
  inferDocumentStructureEndpoint,
  flowEndpoint,
  type FlowInput,
  type LookupTableInput,
  lookupTableEndpoint,
  showcaseSignInEndpoint,
  lookupTablesEndpoint,
  lookupTableSuggestionsEndpoint,
  type MappingGraph,
  mappingDraftEndpoint,
  mappingPreviewEndpoint,
  mappingSamplesEndpoint,
  mappingsEndpoint,
  mappingVersionsEndpoint,
  mappingVersionSummarySchema,
  messageTypeStructureEndpoint,
  operatorWorkspacesEndpoint,
  orderLifecycleEndpoint,
  orderLifecyclesEndpoint,
  homeEndpoint,
  orderLifecycleStatusOf,
  publishedMappingVersionsEndpoint,
  publishMappingDraftEndpoint,
  type ReprocessRunBody,
  reprocessRunEndpoint,
  retryRunEndpoint,
  type RunListQuery,
  runDetailSchema,
  lookupTableMissingCodeHintsEndpoint,
  lookupTableMissingCodesEndpoint,
  runEndpoint,
  runListSchema,
  runsEndpoint,
  saveMappingDraftEndpoint,
  sessionEndpoint,
  sessionSchema,
  signInEndpoint,
  signOutEndpoint,
  submitDocumentEndpoint,
  tasksEndpoint,
  toPath,
  toSearchParams,
  type TradingPartnerInput,
  tradingPartnerSchema,
  updateDocumentStructureEndpoint,
  updateLookupTableEndpoint,
  updateCompanyIdentityEndpoint,
  updateTradingPartnerEndpoint,
  updateWorkspaceSettingsEndpoint,
  waitForTradingPartnerRunEndpoint,
  withCheckDigit,
  workspaceMembersEndpoint,
} from '@edi-bridge/contracts'

import {
  createDocumentStructure,
  createHandlers,
  createMappingDrafts,
  createMappingSample,
  createWorkspace,
  createWorkspaceMembers,
  mockCredentials,
  orderLifecycleReferences,
  seedChannels,
  seedDocumentStructureOf,
  seedExpiredDocuments,
  seedFlows,
  seedLookupTableNamed,
  seedMappingDrafts,
  seedMappings,
  seedSandboxWorkspace,
  seedShowcaseWorkspace,
  seedTradingPartners,
  seedWorkspace,
  seedWorkspaceSettings,
} from './index'
import { day } from './overdue'
import { publishDraft } from './publish-request'
import { seedRunsBeforeAll } from './test-helpers'

const apiUrl = 'http://api.test'

const server = setupServer()

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))

seedRunsBeforeAll()

afterEach(() => server.resetHandlers())

afterAll(() => server.close())

async function listRuns(query: Partial<RunListQuery>) {
  const response = await fetch(`${apiUrl}${runsEndpoint.path}?${toSearchParams(query)}`)

  return runListSchema.parse(await response.json())
}

async function getRun(id: string) {
  const response = await fetch(`${apiUrl}${toPath(runEndpoint.path, { id })}`)

  return runDetailSchema.parse(await response.json())
}

async function orderLifecyclesOf(businessReference: string) {
  const response = await fetch(
    `${apiUrl}${toPath(orderLifecycleEndpoint.path, { businessReference })}`,
  )

  return orderLifecycleEndpoint.response.parse(await response.json())
}

async function send(method: string, path: string, body: TradingPartnerInput | LookupTableInput) {
  return fetch(`${apiUrl}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function post(path: string, body?: ReprocessRunBody) {
  const response = await fetch(`${apiUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? null : JSON.stringify(body),
  })

  return runDetailSchema.parse(await response.json())
}

describe('createHandlers', () => {
  it('lists the members of the session Workspace', async () => {
    server.use(...createHandlers(apiUrl))

    const response = await fetch(`${apiUrl}${workspaceMembersEndpoint.path}`)
    const members = workspaceMembersEndpoint.response.parse(await response.json())

    expect(members.map(({ email }) => email)).toContain(mockCredentials.operator.email)
  })

  it('signs in a user who set their password through an invite', async () => {
    server.use(...createHandlers(apiUrl))

    const json = { 'content-type': 'application/json' }

    const invite = inviteSchema.parse(
      await (
        await fetch(
          `${apiUrl}${toPath(createInviteEndpoint.path, { workspaceId: seedWorkspace.id })}`,
          {
            method: 'POST',
            headers: json,
            body: JSON.stringify({ email: 'ana.berg@nordwind-handel.example', role: 'viewer' }),
          },
        )
      ).json(),
    )

    await fetch(`${apiUrl}${acceptInviteEndpoint.path}`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({
        token: new URL(invite.link).pathname.split('/').at(-1),
        name: 'Ana Berg',
        password: 'ana-password',
      }),
    })

    const signIn = await fetch(`${apiUrl}${signInEndpoint.path}`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ email: invite.email, password: 'ana-password' }),
    })

    expect(signIn.status).toBe(200)
  })

  it('serves the given Workspace members', async () => {
    const workspaceMembers = createWorkspaceMembers({ count: 120 })
    server.use(...createHandlers(apiUrl, { workspaceMembers }))

    const response = await fetch(`${apiUrl}${workspaceMembersEndpoint.path}`)

    expect(await response.json()).toEqual(workspaceMembers)
  })

  it('lists a retried Run as delivered once it is delivered again', async () => {
    server.use(...createHandlers(apiUrl))
    const { runs } = await listRuns({ status: ['failed'], failureStage: ['delivery'] })
    const failed = runs[0]!

    await post(toPath(retryRunEndpoint.path, { id: failed.id }))
    await getRun(failed.id)

    const { runs: listed } = await listRuns({
      flowId: [failed.flow.id],
      receivedFrom: failed.receivedAt,
      receivedTo: failed.receivedAt,
    })

    expect(listed.find(({ id }) => id === failed.id)).toMatchObject({
      status: 'delivered',
      failureStage: null,
    })
  })

  it('counts a retried Run as delivered on Home', async () => {
    server.use(...createHandlers(apiUrl))

    const { runs } = await listRuns({
      status: ['failed'],
      failureStage: ['delivery'],
      receivedFrom: new Date(Date.now() - 23 * 60 * 60 * 1000).toISOString(),
    })

    const failed = runs[0]!

    const failedInWindow = async () => {
      const response = await fetch(`${apiUrl}${homeEndpoint.path}?window=24h`)
      const { throughput } = homeEndpoint.response.parse(await response.json())

      return throughput.reduce((sum, bucket) => sum + bucket.failed, 0)
    }

    const before = await failedInWindow()
    await post(toPath(retryRunEndpoint.path, { id: failed.id }))

    expect(await failedInWindow()).toBe(before - 1)
  })

  it('drops a retried Run from the Tasks', async () => {
    server.use(...createHandlers(apiUrl))

    const taskIds = async () => {
      const response = await fetch(`${apiUrl}${tasksEndpoint.path}`)
      const { tasks } = tasksEndpoint.response.parse(await response.json())

      return tasks.map(({ id }) => id)
    }

    const { runs } = await listRuns({
      status: ['failed'],
      failureStage: ['delivery'],
      receivedFrom: new Date(Date.now() - 23 * 60 * 60 * 1000).toISOString(),
    })

    const failed = runs[0]!

    expect(await taskIds()).toContain(`run:${failed.id}`)

    await post(toPath(retryRunEndpoint.path, { id: failed.id }))

    expect(await taskIds()).not.toContain(`run:${failed.id}`)
  })

  it('lists the Run that a Reprocess started', async () => {
    server.use(...createHandlers(apiUrl))
    const { runs } = await listRuns({ status: ['failed'], failureStage: ['mapping'] })
    const details = await Promise.all(runs.map(({ id }) => getRun(id)))
    const failed = details.find(({ replacedBy }) => replacedBy === null)!

    const versionsResponse = await fetch(
      `${apiUrl}${toPath(mappingVersionsEndpoint.path, { mappingId: failed.mappingVersion!.mappingId })}`,
    )

    const [latest] = mappingVersionsEndpoint.response.parse(await versionsResponse.json())

    const replacing = await post(toPath(reprocessRunEndpoint.path, { id: failed.id }), {
      mappingVersionId: latest!.id,
    })

    const { runs: listed } = await listRuns({ flowId: [failed.flow.id], pageSize: 1 })

    expect(listed[0]).toMatchObject({ id: replacing.id, status: 'delivered' })
  })

  it('offers a version published within the same createHandlers call to Flows and Reprocess', async () => {
    server.use(...createHandlers(apiUrl))
    const { runs } = await listRuns({ status: ['failed'], failureStage: ['mapping'] })
    const details = await Promise.all(runs.map(({ id }) => getRun(id)))
    const failed = details.find(({ replacedBy }) => replacedBy === null)!
    const { mappingId } = failed.mappingVersion!

    await fetch(`${apiUrl}${toPath(saveMappingDraftEndpoint.path, { id: mappingId })}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ links: [], transforms: [], transformLinks: [] }),
    })

    const published = publishMappingDraftEndpoint.response.parse(
      await (await publishDraft(apiUrl, mappingId)).json(),
    )

    const offered = publishedMappingVersionsEndpoint.response.parse(
      await (
        await fetch(
          `${apiUrl}${publishedMappingVersionsEndpoint.path}?${toSearchParams({ messageType: failed.messageType })}`,
        )
      ).json(),
    )

    const flow = flowEndpoint.response.parse(
      await (await fetch(`${apiUrl}${toPath(flowEndpoint.path, { id: failed.flow.id })}`)).json(),
    )

    const replacing = await post(toPath(reprocessRunEndpoint.path, { id: failed.id }), {
      mappingVersionId: published.id,
    })

    const summary = mappingVersionSummarySchema.parse(published)

    expect(offered).toContainEqual(summary)
    expect(flow.newerMappingVersions).toContainEqual(summary)
    expect(replacing.mappingVersion).toEqual(summary)
  })

  it('opens a Mapping created within the same createHandlers call and shows its publication', async () => {
    server.use(...createHandlers(apiUrl))

    const created = createMappingEndpoint.response.parse(
      await (
        await fetch(`${apiUrl}${createMappingEndpoint.path}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            messageType: 'INVOIC',
            documentStructureId: seedDocumentStructureOf.INVOIC.id,
          }),
        })
      ).json(),
    )

    const versionsPath = toPath(mappingVersionsEndpoint.path, { mappingId: created.id })
    const draftPath = toPath(mappingDraftEndpoint.path, { id: created.id })

    expect(await (await fetch(`${apiUrl}${versionsPath}`)).json()).toEqual([])
    expect(
      mappingDraftEndpoint.response.parse(await (await fetch(`${apiUrl}${draftPath}`)).json()),
    ).toMatchObject({ mappingId: created.id, latestVersion: null, links: [] })

    const published = publishMappingDraftEndpoint.response.parse(
      await (await publishDraft(apiUrl, created.id)).json(),
    )

    const mappings = mappingsEndpoint.response.parse(
      await (await fetch(`${apiUrl}${mappingsEndpoint.path}`)).json(),
    )

    expect(mappings.find(({ id }) => id === created.id)).toMatchObject({
      latestVersion: 1,
      latestVersionPublishedAt: published.publishedAt,
      unpublishedChanges: false,
    })
  })

  it('counts the same Documents on a Mapping card as the Run list shows for its Flow', async () => {
    server.use(...createHandlers(apiUrl))
    const [flow] = seedFlows
    const { mappingId } = seedMappings[0]!
    const receivedFrom = new Date(Date.now() - 7 * day).toISOString()
    const all = await listRuns({ flowId: [flow!.id], receivedFrom, pageSize: 1 })
    const failed = await listRuns({ flowId: [flow!.id], receivedFrom, status: ['failed'] })

    const mappings = mappingsEndpoint.response.parse(
      await (await fetch(`${apiUrl}${mappingsEndpoint.path}`)).json(),
    )

    expect(all.total).toBeGreaterThan(0)
    expect(mappings.find(({ id }) => id === mappingId)).toMatchObject({
      documentsLast7Days: all.total,
      failedRunsLast7Days: failed.total,
    })
  })

  it('lists a Mapping that the Flows of two Trading Partners share', async () => {
    server.use(...createHandlers(apiUrl))

    const mappings = mappingsEndpoint.response.parse(
      await (await fetch(`${apiUrl}${mappingsEndpoint.path}`)).json(),
    )

    expect(mappings.some(({ partners }) => partners.length >= 2)).toBe(true)
  })

  it('keeps the changes of one createHandlers call out of another', async () => {
    server.use(...createHandlers(apiUrl))
    const { runs } = await listRuns({ status: ['failed'], failureStage: ['delivery'] })
    await post(toPath(retryRunEndpoint.path, { id: runs[0]!.id }))

    server.resetHandlers(...createHandlers(apiUrl))
    const { runs: fresh } = await listRuns({ status: ['failed'], failureStage: ['delivery'] })

    expect(fresh[0]?.id).toBe(runs[0]!.id)
  })

  it('keeps a created Channel within one createHandlers call', async () => {
    server.use(...createHandlers(apiUrl, { channels: [] }))

    await fetch(`${apiUrl}${createChannelEndpoint.path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'webhook',
        direction: 'inbound',
        name: 'Shop webhook',
        tradingPartnerId: null,
        rateLimitPerMinute: 60,
      }),
    })

    const listChannels = async () =>
      channelsEndpoint.response.parse(
        await (await fetch(`${apiUrl}${channelsEndpoint.path}`)).json(),
      )

    expect(await listChannels()).toHaveLength(1)

    server.resetHandlers(...createHandlers(apiUrl, { channels: [] }))

    expect(await listChannels()).toEqual([])
  })

  it('lets a Flow use a Channel created within the same createHandlers call', async () => {
    server.use(...createHandlers(apiUrl))

    const post = (path: string, body: ChannelInput | FlowInput) =>
      fetch(`${apiUrl}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })

    const { channel } = createChannelEndpoint.response.parse(
      await (
        await post(createChannelEndpoint.path, {
          type: 'webhook',
          direction: 'inbound',
          name: 'Shop webhook',
          tradingPartnerId: null,
          rateLimitPerMinute: 60,
        })
      ).json(),
    )

    const flow = seedFlows.find(({ messageType }) => messageType === 'DESADV')!

    const response = await post(createFlowEndpoint.path, {
      ...flow,
      name: 'Shop DESADV',
      inboundChannelId: channel.id,
    })

    expect(response.status).toBe(201)
  })

  it.each([
    'full',
    'partial',
    'multiPartner',
    'failures',
    'largeVolume',
    'onTrack',
    'waitingForTradingPartner',
  ] as const)('links each Message of the %s Order Lifecycle to its Run detail', async (name) => {
    server.use(...createHandlers(apiUrl))
    const businessReference = orderLifecycleReferences[name]
    const lifecycles = await orderLifecyclesOf(businessReference)

    for (const { run, interchange } of lifecycles.flatMap(({ messages }) => messages)) {
      const detail = await getRun(run.id)
      const referenceTag = detail.messageType === 'ORDERS' ? 'BGM' : 'RFF'
      const reference = detail.message?.segments.find(({ tag }) => tag === referenceTag)

      expect(detail).toMatchObject({
        status: run.status,
        failureStage: run.failureStage,
        replacedBy: run.replacedBy,
      })
      expect(detail.interchange?.id ?? null).toBe(interchange?.id ?? null)
      expect(detail.interchange?.controlReference).toBe(interchange?.controlReference)

      if (detail.message) {
        expect(reference?.elements.flat()).toContain(businessReference)
      }
    }
  })

  it('shows the Order Lifecycle of a Business Reference taken from the Run list', async () => {
    server.use(...createHandlers(apiUrl))
    const { runs } = await listRuns({ messageType: ['DESADV'], status: ['delivered'] })
    const listed = runs[0]!
    const businessReference = listed.businessReference!

    const lifecycles = await orderLifecyclesOf(businessReference)
    const messages = lifecycles.flatMap(({ messages }) => messages)

    expect(lifecycles.map(({ tradingPartner: { id, name } }) => ({ id, name }))).toContainEqual(
      listed.tradingPartner,
    )
    expect(messages.find(({ run }) => run.id === listed.id)).toMatchObject({
      messageType: 'DESADV',
      direction: 'outbound',
      receivedAt: listed.receivedAt,
      run: { status: 'delivered', failureStage: null, replacedBy: null },
      interchange: { id: listed.interchange!.id },
    })

    for (const { run, interchange } of messages) {
      const detail = await getRun(run.id)

      expect(detail).toMatchObject({ status: run.status })
      expect(detail.interchange?.id ?? null).toBe(interchange?.id ?? null)
    }
  })

  it('follows some orders from the Run list through DESADV and INVOIC', async () => {
    server.use(...createHandlers(apiUrl))
    const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString()
    const { runs } = await listRuns({ messageType: ['ORDERS'], receivedTo: twoWeeksAgo })

    const lifecycles = await Promise.all(
      runs.map(({ businessReference }) => orderLifecyclesOf(businessReference!)),
    )

    const followed = lifecycles
      .flat()
      .filter(({ messages }) =>
        ['DESADV', 'INVOIC'].every((messageType) =>
          messages.some((message) => message.messageType === messageType),
        ),
      )

    expect(followed.length).toBeGreaterThan(0)

    for (const { messages } of followed) {
      expect(messages[0]!.messageType).toBe('ORDERS')
    }
  })

  it('lists the orders of the Run list next to the curated ones', async () => {
    server.use(...createHandlers(apiUrl))
    const { runs } = await listRuns({ messageType: ['DESADV'], status: ['delivered'] })
    const listed = runs[0]!

    const response = await fetch(
      `${apiUrl}${orderLifecyclesEndpoint.path}?${toSearchParams({ q: listed.businessReference! })}`,
    )

    const { orderLifecycles } = orderLifecyclesEndpoint.response.parse(await response.json())

    expect(orderLifecycles).toContainEqual(
      expect.objectContaining({
        businessReference: listed.businessReference,
        tradingPartner: listed.tradingPartner,
      }),
    )
  })

  it('shows an order as waiting for the partner once its failed Run is marked', async () => {
    server.use(...createHandlers(apiUrl))

    const { runs } = await listRuns({
      messageType: ['ORDERS'],
      status: ['failed'],
      failureStage: ['parse'],
    })

    const failed = runs.find(
      ({ businessReference, tradingPartner }) =>
        businessReference !== null &&
        runs.filter(
          (other) =>
            other.businessReference === businessReference &&
            other.tradingPartner.id === tradingPartner.id,
        ).length === 1,
    )!

    const lifecycleOf = async () =>
      (await orderLifecyclesOf(failed.businessReference!)).find(
        ({ tradingPartner }) => tradingPartner.id === failed.tradingPartner.id,
      )!

    expect(orderLifecycleStatusOf((await lifecycleOf()).messages)).toBe('needs-attention')

    await post(toPath(waitForTradingPartnerRunEndpoint.path, { id: failed.id }))

    expect(orderLifecycleStatusOf((await lifecycleOf()).messages)).toBe(
      'waiting-for-trading-partner',
    )
  })

  it('shows the seeded waiting mark of an order on its document', async () => {
    server.use(...createHandlers(apiUrl))
    const [lifecycle] = await orderLifecyclesOf(orderLifecycleReferences.waitingForTradingPartner)
    const { run } = lifecycle!.messages[0]!

    expect((await getRun(run.id)).waitingForTradingPartnerSince).toBe(
      run.waitingForTradingPartnerSince,
    )
  })

  it('shows a seeded Run whose Document expired', async () => {
    server.use(...createHandlers(apiUrl))
    const expired = seedExpiredDocuments()

    expect(expired.size).toBeGreaterThan(0)

    for (const [id, deletedAt] of expired) {
      expect(await getRun(id)).toMatchObject({
        status: 'failed',
        failureStage: 'mapping',
        replacedBy: null,
        documentDeletedAt: deletedAt,
      })
    }
  })

  it('lists and shows the Runs of a Manual Submission', async () => {
    server.use(...createHandlers(apiUrl))
    const inbox = seedChannels.find(({ name }) => name === 'Hansemarkt SFTP inbox')!
    await listRuns({})
    await getRun((await listRuns({ pageSize: 1 })).runs[0]!.id)

    const response = await fetch(`${apiUrl}${submitDocumentEndpoint.path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        channelId: inbox.id,
        document: {
          fileName: 'notes.txt',
          content: btoa('Please ship by Friday.'),
          encoding: 'utf-8',
        },
      }),
    })

    const { runs } = submitDocumentEndpoint.response.parse(await response.json())
    const { runs: listed } = await listRuns({ manualSubmission: true, pageSize: 1 })

    expect(listed[0]?.id).toBe(runs[0]!.id)
    expect(await getRun(runs[0]!.id)).toMatchObject({
      manualSubmission: true,
      status: 'failed',
      failureStage: 'parse',
      direction: 'inbound',
    })
  })

  it('serves the Mapping canvas with both of its trees', async () => {
    server.use(...createHandlers(apiUrl))

    const mappings = mappingsEndpoint.response.parse(
      await (await fetch(`${apiUrl}${mappingsEndpoint.path}`)).json(),
    )

    const inbound = mappings.find(({ direction }) => direction === 'inbound')!

    const draft = mappingDraftEndpoint.response.parse(
      await (await fetch(`${apiUrl}${toPath(mappingDraftEndpoint.path, inbound)}`)).json(),
    )

    const trees = await Promise.all([
      fetch(`${apiUrl}${toPath(messageTypeStructureEndpoint.path, inbound)}`),
      fetch(
        `${apiUrl}${toPath(documentStructureEndpoint.path, { id: inbound.documentStructureId })}`,
      ),
    ])

    expect(draft.mappingId).toBe(inbound.id)
    expect(trees.map(({ status }) => status)).toEqual([200, 200])
  })

  it('serves custom Mapping Drafts with their Document Structures', async () => {
    const documentStructure = createDocumentStructure({ fieldCount: 400 })
    const mappingDrafts = createMappingDrafts({ count: 2, documentStructures: [documentStructure] })

    server.use(
      ...createHandlers(apiUrl, { mappingDrafts, documentStructures: [documentStructure] }),
    )

    const mappings = mappingsEndpoint.response.parse(
      await (await fetch(`${apiUrl}${mappingsEndpoint.path}`)).json(),
    )

    const structure = await fetch(
      `${apiUrl}${toPath(documentStructureEndpoint.path, documentStructure)}`,
    )

    expect(mappings.map(({ id }) => id).sort()).toEqual(mappingDrafts.map(({ id }) => id).sort())
    expect(documentStructureEndpoint.response.parse(await structure.json())).toEqual(
      documentStructure,
    )
  })

  it('shows a renamed Document Structure in the Mapping list of the same call', async () => {
    server.use(...createHandlers(apiUrl))
    const { id } = seedDocumentStructureOf.ORDERS

    await fetch(`${apiUrl}${toPath(updateDocumentStructureEndpoint.path, { id })}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'ERP order v2', adjustments: [] }),
    })

    const mappings = mappingsEndpoint.response.parse(
      await (await fetch(`${apiUrl}${mappingsEndpoint.path}`)).json(),
    )

    expect(mappings.filter(({ documentStructureId }) => documentStructureId === id)).not.toEqual([])

    for (const mapping of mappings.filter(
      ({ documentStructureId }) => documentStructureId === id,
    )) {
      expect(mapping.documentStructureName).toBe('ERP order v2')
    }
  })

  it('lists a Document Structure created within the same createHandlers call', async () => {
    server.use(...createHandlers(apiUrl))

    const created = createDocumentStructureEndpoint.response.parse(
      await (
        await fetch(`${apiUrl}${createDocumentStructureEndpoint.path}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            name: 'ERP order',
            origin: documentStructureOrigins.jsonDocument,
          }),
        })
      ).json(),
    )

    const summaries = documentStructuresEndpoint.response.parse(
      await (await fetch(`${apiUrl}${documentStructuresEndpoint.path}`)).json(),
    )

    expect(summaries.find(({ id }) => id === created.id)).toMatchObject({ mappings: [] })
  })

  it('fails the Document Structures when asked', async () => {
    server.use(...createHandlers(apiUrl, { documentStructuresState: 'error' }))

    expect((await fetch(`${apiUrl}${documentStructuresEndpoint.path}`)).status).toBe(500)
  })

  it('fails only the inference of a Document Structure when asked', async () => {
    server.use(...createHandlers(apiUrl, { documentStructureInferenceState: 'error' }))

    const inference = await fetch(`${apiUrl}${inferDocumentStructureEndpoint.path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(documentStructureOrigins.invoiceCsvDocument),
    })

    expect(inference.status).toBe(500)
    expect((await fetch(`${apiUrl}${documentStructuresEndpoint.path}`)).status).toBe(200)
  })

  it('names the inferred fields without AI when the AI budget is used up', async () => {
    server.use(
      ...createHandlers(apiUrl, { documentStructureFieldNamesNotice: 'aiBudgetExhausted' }),
    )

    const inference = await fetch(`${apiUrl}${inferDocumentStructureEndpoint.path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(documentStructureOrigins.invoiceCsvDocument),
    })

    expect(
      inferDocumentStructureEndpoint.response.parse(await inference.json()).fieldNamesNotice
        ?.reason,
    ).toBe('aiBudgetExhausted')
  })

  it('explains the missing codes without AI when the AI budget is used up', async () => {
    server.use(
      ...createHandlers(apiUrl, { lookupTableMissingCodeHintsNotice: 'aiBudgetExhausted' }),
    )
    const units = seedLookupTableNamed('Units of measure')

    const response = await fetch(
      `${apiUrl}${toPath(lookupTableMissingCodeHintsEndpoint.path, units)}`,
      { method: 'POST' },
    )

    expect(
      lookupTableMissingCodeHintsEndpoint.response.parse(await response.json()).notice,
    ).toEqual({
      reason: 'aiBudgetExhausted',
      message: 'AI budget used up for today; codes explained without AI',
    })
  })

  it('refuses suggested values with the budget of the Workspace when it is used up', async () => {
    server.use(
      ...createHandlers(apiUrl, {
        workspaceSettings: {
          ...seedWorkspaceSettings,
          aiTokenBudget: { dailyLimit: 1_000, usedToday: 1_200 },
        },
        lookupTableSuggestions: 'aiBudgetExhausted',
      }),
    )

    const response = await fetch(`${apiUrl}${lookupTableSuggestionsEndpoint.path}?kind=units`)

    expect(response.status).toBe(aiBudgetExhaustedStatus)
    expect(aiBudgetExhaustedProblemSchema.parse(await response.json()).budget).toMatchObject({
      dailyLimit: 1_000,
      usedToday: 1_200,
    })
  })

  it('lists Lookup Tables for the Lookup Table node, and none when asked', async () => {
    const listLookupTables = async () =>
      lookupTablesEndpoint.response.parse(
        await (await fetch(`${apiUrl}${lookupTablesEndpoint.path}`)).json(),
      )

    server.use(...createHandlers(apiUrl))
    expect((await listLookupTables()).length).toBeGreaterThan(0)

    server.resetHandlers(...createHandlers(apiUrl, { lookupTables: [] }))
    expect(await listLookupTables()).toEqual([])
  })

  it('scopes a Lookup Table to a Trading Partner created in the same session', async () => {
    server.use(...createHandlers(apiUrl))

    const partnerResponse = await send('POST', createTradingPartnerEndpoint.path, {
      name: 'Havelland Feinkost GmbH',
      gln: '4012345000009',
      characterSet: 'UNOC',
      acknowledgementTimeLimitHours: 24,
    })

    const partner = tradingPartnerSchema.parse(await partnerResponse.json())

    const response = await send('POST', createLookupTableEndpoint.path, {
      name: 'Havelland units',
      kind: 'units',
      scope: { kind: 'tradingPartner', tradingPartnerId: partner.id },
      entries: [],
    })

    expect(response.status).toBe(201)
    expect(lookupTableEndpoint.response.parse(await response.json()).scope).toEqual({
      kind: 'tradingPartner',
      tradingPartner: { id: partner.id, name: 'Havelland Feinkost GmbH' },
    })
  })

  it('lists a seeded blocking code whose failed Run points back at the same table', async () => {
    server.use(...createHandlers(apiUrl))
    const units = seedLookupTableNamed('Units of measure')

    const codes = lookupTableMissingCodesEndpoint.response.parse(
      await (await fetch(`${apiUrl}${toPath(lookupTableMissingCodesEndpoint.path, units)}`)).json(),
    )

    const krt = codes.find(({ code }) => code === 'KRT')
    const runId = krt?.urgency === 'blocking' ? krt.failedRuns[0]!.id : ''
    const run = await getRun(runId)

    expect(krt?.urgency).toBe('blocking')
    expect(run.problem?.fixTarget).toEqual({
      kind: 'lookupTable',
      lookupTableId: units.id,
      name: 'Units of measure',
      code: 'KRT',
    })
  })

  it('shows the current name of a renamed Trading Partner in Lookup Table scopes', async () => {
    server.use(...createHandlers(apiUrl))
    const hansemarkt = seedTradingPartners.find(({ name }) => name === 'Hansemarkt GmbH')!
    const units = seedLookupTableNamed('Hansemarkt units')

    await send('PUT', toPath(updateTradingPartnerEndpoint.path, hansemarkt), {
      name: 'Hansemarkt Nord GmbH',
      gln: hansemarkt.gln,
      characterSet: hansemarkt.characterSet,
      acknowledgementTimeLimitHours: hansemarkt.acknowledgementTimeLimitHours,
    })

    const table = lookupTableEndpoint.response.parse(
      await (await fetch(`${apiUrl}${toPath(lookupTableEndpoint.path, units)}`)).json(),
    )

    const listed = lookupTablesEndpoint.response.parse(
      await (await fetch(`${apiUrl}${lookupTablesEndpoint.path}`)).json(),
    )

    const renamed = {
      kind: 'tradingPartner',
      tradingPartner: { id: hansemarkt.id, name: 'Hansemarkt Nord GmbH' },
    }

    expect(table.scope).toEqual(renamed)
    expect(listed.find(({ id }) => id === units.id)?.scope).toEqual(renamed)
  })

  it('previews a Lookup Table node with the entries saved for the table', async () => {
    server.use(...createHandlers(apiUrl))
    const vat = seedLookupTableNamed('VAT categories')
    const invoic = seedMappingDrafts.find(({ name }) => name === 'Hansemarkt: ERP JSON to INVOIC')!
    const transformId = '0000000b-0000-4000-8000-000000000001'

    const graph: MappingGraph = {
      links: [],
      transforms: [
        {
          id: transformId,
          kind: 'lookupTable',
          position: { x: 0, y: 0 },
          config: { lookupTableId: vat.id, fallback: 'fail' },
        },
      ],
      transformLinks: [
        {
          from: { kind: 'source', path: 'lines[].vatRate' },
          to: { kind: 'transform', transformId, input: 'value' },
        },
        {
          from: { kind: 'transform', transformId, output: 'value' },
          to: { kind: 'target', path: 'SG25/SG33/TAX+7/C241/5153' },
        },
      ],
    }

    const [sample] = mappingSamplesEndpoint.response.parse(
      await (await fetch(`${apiUrl}${toPath(mappingSamplesEndpoint.path, invoic)}`)).json(),
    )

    await fetch(`${apiUrl}${toPath(updateLookupTableEndpoint.path, vat)}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: vat.name,
        kind: vat.kind,
        scope: { kind: 'workspace' },
        entries: [
          { sourceCode: '19', targetCode: 'E' },
          { sourceCode: '7', targetCode: 'E' },
        ],
      }),
    })

    const response = await fetch(`${apiUrl}${toPath(mappingPreviewEndpoint.path, invoic)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sampleId: sample!.id, graph }),
    })

    const preview = mappingPreviewEndpoint.response.parse(await response.json())
    const lines = preview.document.format === 'edifact' ? preview.document.content.split('\n') : []
    const taxLines = lines.filter((line) => line.startsWith('TAX+7+'))

    expect(taxLines).not.toHaveLength(0)
    expect(new Set(taxLines)).toEqual(new Set(["TAX+7+E'"]))
    expect(preview.notes).toEqual([])
  })

  it('serves the samples and previews of custom Mapping Drafts', async () => {
    const documentStructure = createDocumentStructure({ fieldCount: 40 })
    const [mapping] = createMappingDrafts({ count: 1, documentStructures: [documentStructure] })
    const sample = createMappingSample({ mapping: mapping!, documentStructure })

    server.use(
      ...createHandlers(apiUrl, {
        mappingDrafts: [mapping!],
        documentStructures: [documentStructure],
        mappingSamples: [sample],
      }),
    )

    const samples = mappingSamplesEndpoint.response.parse(
      await (await fetch(`${apiUrl}${toPath(mappingSamplesEndpoint.path, mapping!)}`)).json(),
    )

    const preview = await fetch(`${apiUrl}${toPath(mappingPreviewEndpoint.path, mapping!)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sampleId: sample.id,
        graph: { links: mapping!.links, transforms: [], transformLinks: [] },
      }),
    })

    expect(samples.map(({ id }) => id)).toEqual([sample.id])
    expect(mappingPreviewEndpoint.response.parse(await preview.json()).sampleId).toBe(sample.id)
  })

  it('starts signed in as the Operator in the Workspace the screens show', async () => {
    server.use(...createHandlers(apiUrl))

    const session = sessionSchema.parse(
      await (await fetch(`${apiUrl}${sessionEndpoint.path}`)).json(),
    )

    const current = currentWorkspaceEndpoint.response.parse(
      await (await fetch(`${apiUrl}${currentWorkspaceEndpoint.path}`)).json(),
    )

    expect(session).toMatchObject({ operator: true, role: 'admin' })
    expect(session.workspace).toMatchObject({ id: current.id, name: current.name })
  })

  it('keeps a sign-out within one createHandlers call for the Operator area', async () => {
    server.use(...createHandlers(apiUrl))

    await fetch(`${apiUrl}${signOutEndpoint.path}`, { method: 'POST' })
    const signedOut = await fetch(`${apiUrl}${operatorWorkspacesEndpoint.path}`)

    server.resetHandlers(...createHandlers(apiUrl))
    const fresh = await fetch(`${apiUrl}${operatorWorkspacesEndpoint.path}`)

    expect(signedOut.status).toBe(401)
    expect(fresh.status).toBe(200)
  })

  it('keeps the Showcase Viewer from changing the Workspace settings', async () => {
    server.use(...createHandlers(apiUrl))

    await fetch(`${apiUrl}${showcaseSignInEndpoint.path}`, { method: 'POST' })

    const response = await fetch(`${apiUrl}${updateWorkspaceSettingsEndpoint.path}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ documentRetentionDays: 30, aiTokenBudget: { dailyLimit: 1 } }),
    })

    expect(response.status).toBe(403)
  })

  it('keeps the Showcase Viewer from creating a Trading Partner', async () => {
    server.use(...createHandlers(apiUrl))

    await fetch(`${apiUrl}${showcaseSignInEndpoint.path}`, { method: 'POST' })

    const response = await send('POST', createTradingPartnerEndpoint.path, {
      name: 'Kieler Kontor GmbH',
      gln: null,
      characterSet: 'UNOC',
      acknowledgementTimeLimitHours: 12,
    })

    expect(response.status).toBe(403)
  })

  it.each([
    ['the Showcase sign-in', 'showcase', seedShowcaseWorkspace],
    ['the sandbox-admin sign-in', 'sandbox', seedSandboxWorkspace],
  ] as const)('serves the session Workspace as current after %s', async (_, kind, expected) => {
    server.use(...createHandlers(apiUrl))

    await (kind === 'showcase'
      ? fetch(`${apiUrl}${showcaseSignInEndpoint.path}`, { method: 'POST' })
      : fetch(`${apiUrl}${signInEndpoint.path}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(mockCredentials.sandboxAdmin),
        }))

    const current = currentWorkspaceEndpoint.response.parse(
      await (await fetch(`${apiUrl}${currentWorkspaceEndpoint.path}`)).json(),
    )

    expect(current).toEqual(expected)
  })

  it('shows a company identity change in the Operator Workspace list', async () => {
    server.use(...createHandlers(apiUrl))
    const gln = withCheckDigit('024567800000')

    await fetch(`${apiUrl}${updateCompanyIdentityEndpoint.path}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ gln }),
    })

    const workspaces = operatorWorkspacesEndpoint.response.parse(
      await (await fetch(`${apiUrl}${operatorWorkspacesEndpoint.path}`)).json(),
    )

    expect(workspaces.find(({ id }) => id === seedWorkspace.id)?.gln).toBe(gln)
  })

  it('serves a given Workspace as the current one of the Operator session', async () => {
    const workspace = createWorkspace({ gln: null })
    server.use(...createHandlers(apiUrl, { workspace }))

    const current = await fetch(`${apiUrl}${currentWorkspaceEndpoint.path}`)
    const session = await fetch(`${apiUrl}${sessionEndpoint.path}`)

    expect(await current.json()).toEqual(workspace)
    expect(sessionSchema.parse(await session.json()).workspace.id).toBe(workspace.id)
  })

  it('starts signed out when asked', async () => {
    server.use(...createHandlers(apiUrl, { session: null }))

    expect((await fetch(`${apiUrl}${sessionEndpoint.path}`)).status).toBe(401)
  })
})
