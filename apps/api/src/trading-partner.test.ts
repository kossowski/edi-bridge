import { eq, inArray } from 'drizzle-orm'
import {
  afterAll,
  afterEach,
  assert,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

import {
  canSendTestInterchange,
  canSwitchToProduction,
  createTradingPartnerEndpoint,
  sendTestInterchangeEndpoint,
  switchToProductionEndpoint,
  tradingPartnerActivitiesEndpoint,
  tradingPartnerActivityEndpoint,
  type TradingPartnerInput,
  tradingPartnerEndpoint,
  tradingPartnerSchema,
  tradingPartnersEndpoint,
  testInterchangeRefusedProblem,
  testInterchangeRefusedStatus,
  updateTradingPartnerEndpoint,
  withCheckDigit,
} from '@edi-bridge/contracts'
import {
  channels,
  type Connection,
  documents,
  documentStructures,
  flows,
  mappings,
  mappingVersions,
  runs,
  tradingPartners,
  workspaces,
} from '@edi-bridge/db'
import { type InvoiceWorkspace, seedInvoiceWorkspace } from '@edi-bridge/pipeline/testing'

import {
  addMember,
  type Client,
  otherWorkspace,
  ownWorkspace,
  signIn,
  startTestApi,
  seedWorkspaceWithAdmin,
  type TestApi,
} from './testing.js'

type TradingPartnerBody = Omit<
  TradingPartnerInput,
  'characterSet' | 'acknowledgementTimeLimitHours' | 'messageTypes'
> & {
  characterSet: string
  acknowledgementTimeLimitHours: number | undefined
  messageTypes?: string[] | undefined
}

const hansemarkt: TradingPartnerInput = {
  name: 'Hansemarkt GmbH',
  gln: withCheckDigit('400000000001'),
  characterSet: 'UNOC',
  acknowledgementTimeLimitHours: 24,
}

let api: TestApi

let connection: Connection

let admin: Client

let otherAdmin: Client

beforeAll(async () => {
  api = await startTestApi()
  ;({ connection, admin, otherAdmin } = api)
}, 60_000)

afterAll(async () => {
  await api.stop()
})

beforeEach(async () => {
  await connection.db.delete(tradingPartners)
})

const post = (body: TradingPartnerBody, target = admin) =>
  target.inject({ method: 'POST', url: createTradingPartnerEndpoint.path, body })

const postedTradingPartner = async (body: TradingPartnerBody, target = admin) =>
  tradingPartnerSchema.parse((await post(body, target)).json())

const list = (target = admin) => target.inject({ method: 'GET', url: tradingPartnersEndpoint.path })

const get = (id: string, target = admin) =>
  target.inject({ method: 'GET', url: tradingPartnerEndpoint.path.replace(':id', id) })

const update = (id: string, body: TradingPartnerBody, target = admin) =>
  target.inject({
    method: 'PUT',
    url: updateTradingPartnerEndpoint.path.replace(':id', id),
    body,
  })

const unknownId = '0b6f1a7e-2c4d-4e8f-9a1b-3c5d7e9f1a2b'

describe('POST /trading-partners', () => {
  it('creates a Trading Partner in Test Mode with no onboarding yet', async () => {
    const response = await post(hansemarkt)

    expect(response.statusCode).toBe(201)

    const created = tradingPartnerSchema.parse(response.json())

    expect(created).toEqual({
      ...hansemarkt,
      id: created.id,
      testMode: true,
      onboarding: {
        testInterchangeSentAt: null,
        contrlReceivedAt: null,
        testRejectedAt: null,
        testRejectedRunId: null,
      },
    })

    const read = await get(created.id)

    expect(read.statusCode).toBe(200)
    expect(read.json()).toEqual(created)
  })

  it('stores the Message Types chosen for the Trading Partner', async () => {
    const created = await postedTradingPartner({ ...hansemarkt, messageTypes: ['ORDERS'] })

    expect(created).toMatchObject({ messageTypes: ['ORDERS'] })
    expect((await get(created.id)).json()).toEqual(created)
  })

  it.each([
    ['an empty name', { ...hansemarkt, name: ' ' }],
    ['a GLN with a wrong check digit', { ...hansemarkt, gln: '4000000000010' }],
    ['an unknown character set', { ...hansemarkt, characterSet: 'UTF8' }],
    ['a time limit above a week', { ...hansemarkt, acknowledgementTimeLimitHours: 169 }],
    ['no time limit', { ...hansemarkt, acknowledgementTimeLimitHours: undefined }],
    ['an unknown Message Type', { ...hansemarkt, messageTypes: ['PRICAT'] }],
  ])('rejects %s', async (_case, body) => {
    const response = await post(body)

    expect(response.statusCode).toBe(400)
    expect(response.json()).toHaveProperty('message')

    const listed = await list()

    expect(listed.json()).toEqual([])
  })
})

describe('GET /trading-partners', () => {
  it('lists the Trading Partners of the Workspace by name', async () => {
    const created = []

    for (const name of ['Rheinkauf eG', 'Alpenfrisch Märkte AG', 'Ölmühle Ost GmbH']) {
      created.push(await postedTradingPartner({ ...hansemarkt, name, gln: null }))
    }

    const response = await list()

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual([created[1], created[2], created[0]])
  })

  it('lists nothing for a Workspace without Trading Partners', async () => {
    const response = await list()

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual([])
  })
})

describe('GET /trading-partners/:id', () => {
  it.each([
    ['an unknown id', unknownId],
    ['an id that is no uuid', 'hansemarkt'],
  ])('answers 404 for %s', async (_case, id) => {
    const response = await get(id)

    expect(response.statusCode).toBe(404)
    expect(response.json()).toEqual({ message: 'Not found' })
  })

  describe('a rejected test Interchange', () => {
    let seeded: InvoiceWorkspace | undefined

    afterEach(async () => {
      if (seeded !== undefined) {
        await connection.db.delete(workspaces).where(eq(workspaces.id, seeded.id))
      }
    })

    it('shows when the test was rejected and the Run that sent it', async () => {
      seeded = await seedInvoiceWorkspace(connection.db, 'Refused Test Foods')

      const member = {
        name: 'Refused Test Foods admin',
        email: 'admin@refused-test-foods.example',
        password: 'refused-test-foods-admin-password',
        workspaceId: seeded.id,
        role: 'admin' as const,
      }

      await addMember(connection.db, member)

      const [document] = await connection.db
        .insert(documents)
        .values({
          workspaceId: seeded.id,
          channelId: seeded.inboundChannelId,
          fileName: 'invoice.json',
          content: '{}',
        })
        .returning()

      const [run] = await connection.db
        .insert(runs)
        .values({
          workspaceId: seeded.id,
          documentId: document?.id,
          flowId: seeded.flowId,
          tradingPartnerId: seeded.tradingPartnerId,
          manualSubmission: false,
          status: 'delivered',
        })
        .returning()

      await connection.db
        .update(tradingPartners)
        .set({ testRejectedAt: new Date('2026-10-06T14:05:00.000Z'), testRejectedRunId: run?.id })
        .where(eq(tradingPartners.id, seeded.tradingPartnerId))

      const response = await get(seeded.tradingPartnerId, await signIn(api.app, member))

      expect(response.statusCode).toBe(200)
      expect(response.json()).toMatchObject({
        onboarding: { testRejectedAt: '2026-10-06T14:05:00.000Z', testRejectedRunId: run?.id },
      })
    })
  })
})

describe('PUT /trading-partners/:id', () => {
  const changes: TradingPartnerInput = {
    name: 'Hansemarkt Nord GmbH',
    gln: withCheckDigit('400000000002'),
    characterSet: 'UNOA',
    acknowledgementTimeLimitHours: 48,
  }

  it('stores the changed Trading Partner and keeps its onboarding', async () => {
    const created = await postedTradingPartner(hansemarkt)

    const response = await update(created.id, changes)

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ ...created, ...changes })

    const read = await get(created.id)

    expect(read.json()).toEqual({ ...created, ...changes })
  })

  it('rejects an invalid Trading Partner and keeps the stored one', async () => {
    const created = await postedTradingPartner(hansemarkt)

    const response = await update(created.id, { ...changes, name: '' })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toHaveProperty('message')

    const read = await get(created.id)

    expect(read.json()).toEqual(created)
  })

  it.each([
    ['an unknown id', unknownId],
    ['an id that is no uuid', 'hansemarkt'],
  ])('answers 404 for %s', async (_case, id) => {
    const response = await update(id, changes)

    expect(response.statusCode).toBe(404)
    expect(response.json()).toEqual({ message: 'Not found' })
  })

  it('answers 404 before it checks the Trading Partner', async () => {
    const response = await update(unknownId, { ...changes, name: '' })

    expect(response.statusCode).toBe(404)
  })
})

describe('a Trading Partner of another Workspace', () => {
  it('is neither listed, read nor updated', async () => {
    const own = await postedTradingPartner(hansemarkt)

    const foreign = await postedTradingPartner(
      { ...hansemarkt, name: 'Elbtal Warenhaus KG' },
      otherAdmin,
    )

    const listed = await list()

    expect(listed.json()).toEqual([own])

    const read = await get(foreign.id)

    expect(read.statusCode).toBe(404)

    const updated = await update(foreign.id, { ...hansemarkt, name: 'Taken over' })

    expect(updated.statusCode).toBe(404)

    const unchanged = await get(foreign.id, otherAdmin)

    expect(unchanged.json()).toEqual(foreign)
  })
})

describe('the GLN of a Trading Partner', () => {
  const glnConflict = { message: 'Another Trading Partner already uses this GLN' }

  it('is unique within the Workspace on create', async () => {
    await postedTradingPartner(hansemarkt)

    const response = await post({ ...hansemarkt, name: 'Rheinkauf eG' })

    expect(response.statusCode).toBe(409)
    expect(response.json()).toEqual(glnConflict)

    const listed = await list()

    expect(listed.json()).toHaveLength(1)
  })

  it('is unique within the Workspace on update', async () => {
    await postedTradingPartner(hansemarkt)
    const other = await postedTradingPartner({ ...hansemarkt, name: 'Rheinkauf eG', gln: null })

    const response = await update(other.id, { ...hansemarkt, name: 'Rheinkauf eG' })

    expect(response.statusCode).toBe(409)
    expect(response.json()).toEqual(glnConflict)

    const read = await get(other.id)

    expect(read.json()).toEqual(other)
  })

  it('stays with the Trading Partner that updates itself', async () => {
    const created = await postedTradingPartner(hansemarkt)

    const response = await update(created.id, { ...hansemarkt, acknowledgementTimeLimitHours: 4 })

    expect(response.statusCode).toBe(200)
  })

  it('may be used by Trading Partners without a GLN and in another Workspace', async () => {
    await postedTradingPartner({ ...hansemarkt, gln: null })
    await postedTradingPartner(hansemarkt, otherAdmin)

    const second = await post({ ...hansemarkt, name: 'Rheinkauf eG', gln: null })
    const own = await post(hansemarkt)

    expect(second.statusCode).toBe(201)
    expect(own.statusCode).toBe(201)
  })

  it('stays once Interchanges were exchanged', async () => {
    const created = await postedTradingPartner(hansemarkt)

    await connection.db
      .update(tradingPartners)
      .set({ testInterchangeSentAt: new Date('2026-10-06T14:03:00.000Z') })
      .where(eq(tradingPartners.id, created.id))

    const response = await update(created.id, { ...hansemarkt, gln: null })

    expect(response.statusCode).toBe(422)
    expect(response.json()).toEqual({
      message: 'The Trading Partner needs its GLN once Interchanges were exchanged',
    })

    const read = await get(created.id)

    expect(read.json()).toEqual({
      ...created,
      onboarding: {
        testInterchangeSentAt: '2026-10-06T14:03:00.000Z',
        contrlReceivedAt: null,
        testRejectedAt: null,
        testRejectedRunId: null,
      },
    })
  })

  it('stays once the Trading Partner is in production', async () => {
    const created = await postedTradingPartner(hansemarkt)

    await connection.db
      .update(tradingPartners)
      .set({ testMode: false })
      .where(eq(tradingPartners.id, created.id))

    const response = await update(created.id, { ...hansemarkt, gln: null })

    expect(response.statusCode).toBe(422)
  })

  it('may be removed during Test Mode before the test Interchange', async () => {
    const created = await postedTradingPartner(hansemarkt)

    const response = await update(created.id, { ...hansemarkt, gln: null })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ ...created, gln: null })
  })
})

describe('GET /trading-partners/activity', () => {
  it('lists each Trading Partner of the Workspace with no Runs until Runs exist', async () => {
    const created = await postedTradingPartner(hansemarkt)
    await postedTradingPartner({ ...hansemarkt, gln: null }, otherAdmin)

    const response = await admin.inject({
      method: 'GET',
      url: tradingPartnerActivitiesEndpoint.path,
    })

    expect(response.statusCode).toBe(200)
    expect(tradingPartnerActivitiesEndpoint.response.parse(response.json())).toEqual([
      {
        tradingPartnerId: created.id,
        runsToday: 0,
        openProblems: 0,
        lastActivityAt: null,
        channelCount: 0,
        flowCount: 0,
        channelDirections: [],
        neededDirections: ['inbound', 'outbound'],
      },
    ])
  })
})

describe('the Channel directions of a Trading Partner', () => {
  let seeded: string | undefined

  afterEach(async () => {
    await connection.db
      .delete(channels)
      .where(inArray(channels.workspaceId, [ownWorkspace.id, otherWorkspace.id]))

    if (seeded !== undefined) {
      await connection.db.delete(workspaces).where(eq(workspaces.id, seeded))
      seeded = undefined
    }
  })

  const getActivities = (target = admin) =>
    target.inject({ method: 'GET', url: tradingPartnerActivitiesEndpoint.path })

  const getActivity = (id: string, target = admin) =>
    target.inject({ method: 'GET', url: tradingPartnerActivityEndpoint.path.replace(':id', id) })

  const addOutboundChannel = (tradingPartnerId: string | null, workspaceId = ownWorkspace.id) =>
    connection.db.insert(channels).values({
      workspaceId,
      tradingPartnerId,
      type: 'http',
      direction: 'outbound',
      name: `Inbox ${crypto.randomUUID()}`,
      url: 'https://edi.example.com/inbox',
    })

  it('needs the directions of the chosen Message Types and names the own Channels', async () => {
    const created = await postedTradingPartner({
      ...hansemarkt,
      messageTypes: ['ORDERS', 'INVOIC'],
    })

    const other = await postedTradingPartner({ ...hansemarkt, name: 'Rheinkauf eG', gln: null })
    await addOutboundChannel(created.id)
    await addOutboundChannel(null)

    const directions = {
      channelCount: 1,
      channelDirections: ['outbound'],
      neededDirections: ['inbound', 'outbound'],
    }

    expect(tradingPartnerActivitiesEndpoint.response.parse((await getActivities()).json())).toEqual(
      [
        expect.objectContaining({ tradingPartnerId: created.id, ...directions }),
        expect.objectContaining({
          tradingPartnerId: other.id,
          channelCount: 0,
          channelDirections: [],
          neededDirections: ['inbound', 'outbound'],
        }),
      ],
    )
    expect(
      tradingPartnerActivityEndpoint.response.parse((await getActivity(created.id)).json()),
    ).toMatchObject(directions)
  })

  it('leaves out a Channel of another Workspace', async () => {
    const created = await postedTradingPartner(hansemarkt)
    await addOutboundChannel(created.id, otherWorkspace.id)

    const directions = { channelCount: 0, channelDirections: [] }

    expect(tradingPartnerActivitiesEndpoint.response.parse((await getActivities()).json())).toEqual(
      [expect.objectContaining({ tradingPartnerId: created.id, ...directions })],
    )
    expect(
      tradingPartnerActivityEndpoint.response.parse((await getActivity(created.id)).json()),
    ).toMatchObject(directions)
  })

  it('needs the direction of each Flow of the Trading Partner', async () => {
    const { workspace, admin: seededAdmin } = await seedWorkspaceWithAdmin(
      api,
      'Flow Directions AG',
    )

    seeded = workspace.id

    // The seeded INVOIC Flow takes its Documents from a shared inbound webhook.
    const directions = { channelDirections: ['outbound'], neededDirections: ['outbound'] }

    expect(
      tradingPartnerActivitiesEndpoint.response.parse((await getActivities(seededAdmin)).json()),
    ).toEqual([
      expect.objectContaining({ tradingPartnerId: workspace.tradingPartnerId, ...directions }),
    ])
    expect(
      tradingPartnerActivityEndpoint.response.parse(
        (await getActivity(workspace.tradingPartnerId, seededAdmin)).json(),
      ),
    ).toMatchObject(directions)
  })
})

describe('GET /trading-partners/:id/activity', () => {
  const getActivity = (id: string, target = admin) =>
    target.inject({ method: 'GET', url: tradingPartnerActivityEndpoint.path.replace(':id', id) })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('answers no activity over the last seven days until Runs exist', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-14T23:30:00.000Z') })
    const created = await postedTradingPartner(hansemarkt)

    const response = await getActivity(created.id)

    expect(response.statusCode).toBe(200)
    expect(tradingPartnerActivityEndpoint.response.parse(response.json())).toEqual({
      tradingPartnerId: created.id,
      runsToday: 0,
      openProblems: 0,
      lastActivityAt: null,
      channelCount: 0,
      flowCount: 0,
      channelDirections: [],
      neededDirections: ['inbound', 'outbound'],
      days: ['08', '09', '10', '11', '12', '13', '14'].map((day) => ({
        date: `2026-10-${day}`,
        runs: 0,
        failed: 0,
      })),
      flows: [],
      problems: [],
    })
  })

  it.each([
    ['an unknown id', unknownId],
    ['an id that is no uuid', 'hansemarkt'],
  ])('answers 404 for %s', async (_case, id) => {
    const response = await getActivity(id)

    expect(response.statusCode).toBe(404)
    expect(response.json()).toEqual({ message: 'Not found' })
  })

  it('answers 404 for a Trading Partner of another Workspace', async () => {
    const created = await postedTradingPartner(hansemarkt)

    const response = await getActivity(created.id, otherAdmin)

    expect(response.statusCode).toBe(404)
  })
})

describe('POST /trading-partners/:id/production', () => {
  const postProduction = (id: string, target = admin) =>
    target.inject({ method: 'POST', url: switchToProductionEndpoint.path.replace(':id', id) })

  type Onboarding = Pick<
    typeof tradingPartners.$inferInsert,
    'testInterchangeSentAt' | 'contrlReceivedAt' | 'testMode'
  >

  const onboarded: Onboarding = {
    testInterchangeSentAt: new Date('2026-10-06T14:03:00.000Z'),
    contrlReceivedAt: new Date('2026-10-06T14:05:00.000Z'),
  }

  const setOnboarding = (id: string, onboarding: Onboarding) =>
    connection.db.update(tradingPartners).set(onboarding).where(eq(tradingPartners.id, id))

  const workspaceGln = withCheckDigit('400000000099')

  const setWorkspaceGln = (gln: string | null) =>
    connection.db.update(workspaces).set({ gln }).where(eq(workspaces.id, ownWorkspace.id))

  beforeEach(async () => {
    await setWorkspaceGln(workspaceGln)
  })

  afterEach(async () => {
    await setWorkspaceGln(null)
  })

  it('takes a Trading Partner out of Test Mode once its onboarding is complete', async () => {
    const created = await postedTradingPartner(hansemarkt)
    await setOnboarding(created.id, onboarded)

    const response = await postProduction(created.id)

    const expected = {
      ...created,
      testMode: false,
      onboarding: {
        testInterchangeSentAt: '2026-10-06T14:03:00.000Z',
        contrlReceivedAt: '2026-10-06T14:05:00.000Z',
        testRejectedAt: null,
        testRejectedRunId: null,
      },
    }

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual(expected)

    const read = await get(created.id)

    expect(read.json()).toEqual(expected)
  })

  it.each<{
    state: string
    switchable: boolean
    workspaceGln?: string | null
    gln?: string | null
    onboarding?: Partial<Onboarding>
    testMode?: boolean
  }>([
    { state: 'its onboarding is complete', switchable: true },
    { state: 'the Workspace has no GLN', switchable: false, workspaceGln: null },
    { state: 'the Trading Partner has no GLN', switchable: false, gln: null },
    {
      state: 'no test Interchange was sent',
      switchable: false,
      onboarding: { testInterchangeSentAt: null },
    },
    { state: 'no CONTRL was received', switchable: false, onboarding: { contrlReceivedAt: null } },
    { state: 'it is already in production', switchable: false, testMode: false },
  ])(
    'answers as canSwitchToProduction does while $state',
    async ({
      switchable,
      workspaceGln: currentWorkspaceGln = workspaceGln,
      gln = hansemarkt.gln,
      onboarding = {},
      testMode = true,
    }) => {
      await setWorkspaceGln(currentWorkspaceGln)
      const created = await postedTradingPartner({ ...hansemarkt, gln })
      await setOnboarding(created.id, { ...onboarded, ...onboarding, testMode })
      const before = tradingPartnerSchema.parse((await get(created.id)).json())
      const after = switchable ? { ...before, testMode: false } : before

      expect(canSwitchToProduction(before, currentWorkspaceGln)).toBe(switchable)

      const response = await postProduction(created.id)

      expect(response.statusCode).toBe(switchable ? 200 : 409)
      expect(response.json()).toEqual(
        switchable ? after : { message: 'Onboarding is not complete' },
      )
      expect((await get(created.id)).json()).toEqual(after)
    },
  )

  it.each([
    ['an unknown id', unknownId],
    ['an id that is no uuid', 'hansemarkt'],
  ])('answers 404 for %s', async (_case, id) => {
    const response = await postProduction(id)

    expect(response.statusCode).toBe(404)
    expect(response.json()).toEqual({ message: 'Not found' })
  })

  it('answers 404 for a Trading Partner of another Workspace', async () => {
    const created = await postedTradingPartner(hansemarkt, otherAdmin)
    await setOnboarding(created.id, onboarded)

    const response = await postProduction(created.id)

    expect(response.statusCode).toBe(404)
    expect((await get(created.id, otherAdmin)).json()).toMatchObject({ testMode: true })
  })
})

describe('POST /trading-partners/:id/test-interchange', () => {
  const postTest = (id: string, target = admin) =>
    target.inject({ method: 'POST', url: sendTestInterchangeEndpoint.path.replace(':id', id) })

  let seeded: InvoiceWorkspace | undefined

  let seededAdmin: Client

  afterEach(async () => {
    if (seeded !== undefined) {
      await connection.db.delete(workspaces).where(eq(workspaces.id, seeded.id))
      seeded = undefined
    }
  })

  const sample = {
    sampleFileName: 'invoice-sample.json',
    sampleText: '{"invoiceNumber":"87441"}',
    sampleTakenAt: new Date('2026-10-01T08:00:00.000Z'),
  }

  const noSample = { sampleFileName: null, sampleText: null, sampleTakenAt: null }

  const setSample = (documentStructureId: string, values: typeof sample | typeof noSample) =>
    connection.db
      .update(documentStructures)
      .set(values)
      .where(eq(documentStructures.id, documentStructureId))

  const setPartner = (values: Partial<typeof tradingPartners.$inferInsert>) =>
    connection.db
      .update(tradingPartners)
      .set(values)
      .where(eq(tradingPartners.id, seeded?.tradingPartnerId ?? ''))

  // A Workspace with an outbound INVOIC Flow to a Trading Partner in Test Mode.
  const seedTestingWorkspace = async (name: string) => {
    const into = await seedInvoiceWorkspace(connection.db, name)
    const slug = name.toLowerCase().replaceAll(' ', '-')

    const member = {
      name: `${name} admin`,
      email: `admin@${slug}.example`,
      password: `${slug}-admin-password`,
      workspaceId: into.id,
      role: 'admin' as const,
    }

    await addMember(connection.db, member)
    seeded = into
    seededAdmin = await signIn(api.app, member)
    await setPartner({ testMode: true })
    await setSample(into.documentStructureId, sample)

    return into
  }

  const runsOf = (into: InvoiceWorkspace) =>
    connection.db
      .select({
        id: runs.id,
        flowId: runs.flowId,
        manualSubmission: runs.manualSubmission,
        status: runs.status,
        fileName: documents.fileName,
        content: documents.content,
      })
      .from(runs)
      .innerJoin(documents, eq(documents.id, runs.documentId))
      .where(eq(runs.workspaceId, into.id))

  // A second outbound Flow with its own Mapping on its own Document Structure.
  const addInvoiceFlow = async (into: InvoiceWorkspace, name: string) => {
    const [mapping] = await connection.db
      .select()
      .from(mappings)
      .where(eq(mappings.id, into.mappingId))

    const [version] = await connection.db
      .select()
      .from(mappingVersions)
      .where(eq(mappingVersions.id, into.mappingVersionId))

    const [structure] = await connection.db
      .select()
      .from(documentStructures)
      .where(eq(documentStructures.id, into.documentStructureId))

    assert(mapping && version && structure)

    const [otherStructure] = await connection.db
      .insert(documentStructures)
      .values({ ...structure, id: undefined, name: `${name} structure`, ...noSample })
      .returning()

    assert(otherStructure)

    const [otherMapping] = await connection.db
      .insert(mappings)
      .values({
        ...mapping,
        id: undefined,
        name: `${name} mapping`,
        documentStructureId: otherStructure.id,
      })
      .returning()

    assert(otherMapping)

    const [otherVersion] = await connection.db
      .insert(mappingVersions)
      .values({ ...version, id: undefined, mappingId: otherMapping.id })
      .returning()

    assert(otherVersion)

    const [flow] = await connection.db
      .insert(flows)
      .values({
        workspaceId: into.id,
        tradingPartnerId: into.tradingPartnerId,
        messageType: 'INVOIC',
        name,
        inboundChannelId: into.inboundChannelId,
        destinationChannelId: into.outboundChannelId,
        mappingVersionId: otherVersion.id,
      })
      .returning()

    assert(flow)

    return { flowId: flow.id, documentStructureId: otherStructure.id }
  }

  it('runs the sample of the outbound Flow as a Run and answers the Trading Partner', async () => {
    const into = await seedTestingWorkspace('Sample Test Foods')
    const queuedBefore = api.runQueue.queued.length

    const before = tradingPartnerSchema.parse(
      (await get(into.tradingPartnerId, seededAdmin)).json(),
    )

    const response = await postTest(into.tradingPartnerId, seededAdmin)

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual(before)

    const [sent, ...more] = await runsOf(into)

    expect(more).toEqual([])
    assert(sent)
    const { id: runId, ...run } = sent
    expect(run).toEqual({
      flowId: into.flowId,
      manualSubmission: true,
      status: 'received',
      fileName: 'invoice-sample.json',
      content: '{"invoiceNumber":"87441"}',
    })
    expect(api.runQueue.queued.slice(queuedBefore)).toEqual([{ workspaceId: into.id, runId }])
  })

  it('clears the rejection of the earlier test Interchange', async () => {
    const into = await seedTestingWorkspace('Resent Test Foods')

    await postTest(into.tradingPartnerId, seededAdmin)

    const [rejected] = await runsOf(into)

    await connection.db
      .update(runs)
      .set({ status: 'delivered', handedOverAt: new Date('2026-10-06T14:03:00.000Z') })
      .where(eq(runs.id, rejected?.id ?? ''))
    await setPartner({
      testInterchangeSentAt: new Date('2026-10-06T14:03:00.000Z'),
      testRejectedAt: new Date('2026-10-06T14:05:00.000Z'),
      testRejectedRunId: rejected?.id,
    })

    const response = await postTest(into.tradingPartnerId, seededAdmin)

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      onboarding: {
        testInterchangeSentAt: '2026-10-06T14:03:00.000Z',
        contrlReceivedAt: null,
        testRejectedAt: null,
        testRejectedRunId: null,
      },
    })
    await expect(runsOf(into)).resolves.toHaveLength(2)
  })

  it.each<{
    state: string
    sendable: boolean
    earlier: Partial<typeof runs.$inferInsert>
  }>([
    { state: 'waits for processing', sendable: false, earlier: { status: 'received' } },
    { state: 'is in processing', sendable: false, earlier: { status: 'processing' } },
    {
      state: 'was handed over',
      sendable: true,
      earlier: { status: 'delivered', handedOverAt: new Date('2026-10-06T14:03:00.000Z') },
    },
    {
      state: 'failed',
      sendable: true,
      earlier: {
        status: 'failed',
        failureStage: 'delivery',
        error: { code: 'unreachable', message: 'Unreachable', position: null, details: null },
        problem: { reason: 'defect', fixTarget: null },
      },
    },
  ])(
    'answers a second test while the earlier test Run $state',
    async ({ state, sendable, earlier }) => {
      const into = await seedTestingWorkspace(`Second Test Foods ${state}`)

      await postTest(into.tradingPartnerId, seededAdmin)

      const [first] = await runsOf(into)

      await connection.db
        .update(runs)
        .set(earlier)
        .where(eq(runs.id, first?.id ?? ''))

      const queuedBefore = api.runQueue.queued.length

      const response = await postTest(into.tradingPartnerId, seededAdmin)

      expect(response.statusCode).toBe(sendable ? 200 : testInterchangeRefusedStatus)

      if (!sendable) {
        expect(response.json()).toEqual(testInterchangeRefusedProblem({ reason: 'notAwaited' }))
      }

      await expect(runsOf(into)).resolves.toHaveLength(sendable ? 2 : 1)
      expect(api.runQueue.queued.slice(queuedBefore)).toHaveLength(sendable ? 1 : 0)
    },
  )

  it('refuses the second of two tests sent right after another', async () => {
    const into = await seedTestingWorkspace('Twice Test Foods')

    const first = await postTest(into.tradingPartnerId, seededAdmin)
    const second = await postTest(into.tradingPartnerId, seededAdmin)

    expect(first.statusCode).toBe(200)
    expect(second.statusCode).toBe(testInterchangeRefusedStatus)
    expect(second.json()).toEqual(testInterchangeRefusedProblem({ reason: 'notAwaited' }))
    await expect(runsOf(into)).resolves.toHaveLength(1)
  })

  it('refuses one of two tests sent at once', async () => {
    const into = await seedTestingWorkspace('At Once Test Foods')

    const responses = await Promise.all([
      postTest(into.tradingPartnerId, seededAdmin),
      postTest(into.tradingPartnerId, seededAdmin),
    ])

    expect(responses.map(({ statusCode }) => statusCode).toSorted()).toEqual([
      200,
      testInterchangeRefusedStatus,
    ])
    await expect(runsOf(into)).resolves.toHaveLength(1)
  })

  it('sends the sample of the first outbound Flow by name that has one', async () => {
    const into = await seedTestingWorkspace('Several Flows Foods')
    const withoutSample = await addInvoiceFlow(into, 'A invoices without sample')
    const later = await addInvoiceFlow(into, 'Z invoices with sample')

    await setSample(later.documentStructureId, sample)

    const response = await postTest(into.tradingPartnerId, seededAdmin)

    expect(response.statusCode).toBe(200)
    expect(withoutSample.flowId).not.toBe(into.flowId)
    await expect(runsOf(into)).resolves.toMatchObject([{ flowId: into.flowId }])
  })

  it.each<{
    state: string
    sendable: boolean
    workspaceGln?: string | null
    partner?: Partial<typeof tradingPartners.$inferInsert>
  }>([
    { state: 'no test Interchange was sent', sendable: true },
    {
      state: 'a test Interchange was sent',
      sendable: true,
      partner: { testInterchangeSentAt: new Date('2026-10-06T14:03:00.000Z') },
    },
    { state: 'the Workspace has no GLN', sendable: false, workspaceGln: null },
    { state: 'the Trading Partner has no GLN', sendable: false, partner: { gln: null } },
    {
      state: 'a CONTRL was received',
      sendable: false,
      partner: { contrlReceivedAt: new Date('2026-10-06T14:05:00.000Z') },
    },
    { state: 'it is in production', sendable: false, partner: { testMode: false } },
  ])(
    'answers as canSendTestInterchange does while $state',
    async ({ state, sendable, workspaceGln, partner = { testMode: true } }) => {
      const into = await seedTestingWorkspace(`Awaited Foods ${state}`)

      if (workspaceGln !== undefined) {
        await connection.db
          .update(workspaces)
          .set({ gln: workspaceGln })
          .where(eq(workspaces.id, into.id))
      }

      await setPartner(partner)

      const before = tradingPartnerSchema.parse(
        (await get(into.tradingPartnerId, seededAdmin)).json(),
      )

      const [workspace] = await connection.db
        .select({ gln: workspaces.gln })
        .from(workspaces)
        .where(eq(workspaces.id, into.id))

      expect(canSendTestInterchange(before, workspace?.gln ?? null)).toBe(sendable)

      const response = await postTest(into.tradingPartnerId, seededAdmin)

      expect(response.statusCode).toBe(sendable ? 200 : testInterchangeRefusedStatus)
      expect(response.json()).toEqual(
        sendable ? before : testInterchangeRefusedProblem({ reason: 'notAwaited' }),
      )
      await expect(runsOf(into)).resolves.toHaveLength(sendable ? 1 : 0)
    },
  )

  it('refuses without an outbound Flow to the Trading Partner', async () => {
    const into = await seedTestingWorkspace('Flowless Test Foods')

    await connection.db.delete(flows).where(eq(flows.id, into.flowId))

    const response = await postTest(into.tradingPartnerId, seededAdmin)

    expect(response.statusCode).toBe(testInterchangeRefusedStatus)
    expect(response.json()).toEqual(testInterchangeRefusedProblem({ reason: 'noOutboundFlow' }))
  })

  it('refuses without a sample on the Document Structure of any outbound Flow and names the first Flow', async () => {
    const into = await seedTestingWorkspace('Sampleless Test Foods')

    await setSample(into.documentStructureId, noSample)
    await addInvoiceFlow(into, 'Z invoices without sample')

    const response = await postTest(into.tradingPartnerId, seededAdmin)

    expect(response.statusCode).toBe(testInterchangeRefusedStatus)
    expect(response.json()).toEqual(
      testInterchangeRefusedProblem({
        reason: 'sampleMissing',
        flow: { id: into.flowId, name: 'Invoices to Hanse Retail' },
      }),
    )
    await expect(runsOf(into)).resolves.toEqual([])
  })

  it.each([
    ['an unknown id', unknownId],
    ['an id that is no uuid', 'hansemarkt'],
  ])('answers 404 for %s', async (_case, id) => {
    const response = await postTest(id)

    expect(response.statusCode).toBe(404)
    expect(response.json()).toEqual({ message: 'Not found' })
  })

  it('answers 404 for a Trading Partner of another Workspace', async () => {
    const into = await seedTestingWorkspace('Foreign Test Foods')

    const response = await postTest(into.tradingPartnerId)

    expect(response.statusCode).toBe(404)
    await expect(runsOf(into)).resolves.toEqual([])
  })
})
