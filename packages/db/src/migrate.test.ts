import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { withCheckDigit } from '@edi-bridge/contracts'

import { connect, type Connection } from './client.js'
import { migrate } from './migrate.js'
import { lookupTableEntries, lookupTables, tradingPartners, workspaces } from './schema.js'
import { startTestDatabase, type TestDatabase } from './testing.js'

const tradingPartner = {
  name: 'Hanse Retail',
  gln: withCheckDigit('020000000002'),
  characterSet: 'UNOC',
  acknowledgementTimeLimitHours: 24,
} satisfies Omit<typeof tradingPartners.$inferInsert, 'workspaceId'>

let testDatabase: TestDatabase

let connection: Connection

beforeAll(async () => {
  testDatabase = await startTestDatabase()
  connection = connect(testDatabase.url)
}, 60_000)

afterAll(async () => {
  await connection.close()
  await testDatabase.stop()
})

async function insertWorkspace() {
  const [workspace] = await connection.db
    .insert(workspaces)
    .values({ name: 'Nordwind Foods', gln: withCheckDigit('020000000001') })
    .returning()

  if (workspace === undefined) {
    throw new Error('Workspace insert returned no row')
  }

  return workspace
}

describe('migrate', () => {
  it('applies again without changes to an up-to-date database', async () => {
    await expect(migrate(testDatabase.url)).resolves.toBeUndefined()
  })
})

describe('schema', () => {
  it('stores a Trading Partner in Test Mode with empty onboarding', async () => {
    const workspace = await insertWorkspace()

    const [stored] = await connection.db
      .insert(tradingPartners)
      .values({ ...tradingPartner, workspaceId: workspace.id })
      .returning()

    expect(stored).toMatchObject({
      ...tradingPartner,
      workspaceId: workspace.id,
      testMode: true,
      testInterchangeSentAt: null,
      contrlReceivedAt: null,
    })
  })

  it('returns an onboarding timestamp as the same instant', async () => {
    const workspace = await insertWorkspace()
    const sentAt = new Date('2026-10-14T12:00:00.123Z')

    const [stored] = await connection.db
      .insert(tradingPartners)
      .values({ ...tradingPartner, workspaceId: workspace.id, testInterchangeSentAt: sentAt })
      .returning()

    expect(stored?.testInterchangeSentAt).toEqual(sentAt)
  })

  it('rejects a Trading Partner without an existing Workspace', async () => {
    await expect(
      connection.db
        .insert(tradingPartners)
        .values({ ...tradingPartner, workspaceId: '00000000-0000-4000-8000-000000000000' }),
    ).rejects.toThrow()
  })
})

describe('a Lookup Table', () => {
  async function insertLookupTable(workspaceId: string, tradingPartnerId: string | null = null) {
    const [lookupTable] = await connection.db
      .insert(lookupTables)
      .values({ workspaceId, tradingPartnerId, name: 'Units', kind: 'units' })
      .returning()

    if (lookupTable === undefined) {
      throw new Error('Lookup Table insert returned no row')
    }

    await connection.db
      .insert(lookupTableEntries)
      .values({ lookupTableId: lookupTable.id, position: 0, sourceCode: 'ST', targetCode: 'PCE' })

    return lookupTable
  }

  const entriesOf = (lookupTableId: string) =>
    connection.db
      .select()
      .from(lookupTableEntries)
      .where(eq(lookupTableEntries.lookupTableId, lookupTableId))

  it('takes its entries along when deleted', async () => {
    const workspace = await insertWorkspace()
    const lookupTable = await insertLookupTable(workspace.id)

    await connection.db.delete(lookupTables).where(eq(lookupTables.id, lookupTable.id))

    await expect(entriesOf(lookupTable.id)).resolves.toEqual([])
  })

  it('is deleted with the Trading Partner it belongs to', async () => {
    const workspace = await insertWorkspace()

    const [partner] = await connection.db
      .insert(tradingPartners)
      .values({ ...tradingPartner, gln: null, workspaceId: workspace.id })
      .returning({ id: tradingPartners.id })

    if (partner === undefined) {
      throw new Error('Trading Partner insert returned no row')
    }

    const lookupTable = await insertLookupTable(workspace.id, partner.id)

    await connection.db.delete(tradingPartners).where(eq(tradingPartners.id, partner.id))

    await expect(
      connection.db.select().from(lookupTables).where(eq(lookupTables.id, lookupTable.id)),
    ).resolves.toEqual([])
    await expect(entriesOf(lookupTable.id)).resolves.toEqual([])
  })
})
