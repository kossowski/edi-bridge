import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { withCheckDigit } from '@edi-bridge/contracts'

import { connect, type Connection } from './client.js'
import { migrate } from './migrate.js'
import { tradingPartners, workspaces } from './schema.js'
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
