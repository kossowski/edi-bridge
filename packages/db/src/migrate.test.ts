import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { connect, type Database } from './client.js'
import { migrate } from './migrate.js'
import { tradingPartners, workspaces } from './schema.js'
import { startTestDatabase, type TestDatabase } from './testing.js'

let testDatabase: TestDatabase

let database: Database

beforeAll(async () => {
  testDatabase = await startTestDatabase()
  database = connect(testDatabase.url)
}, 60_000)

afterAll(async () => {
  await database.close()
  await testDatabase.stop()
})

describe('migrate', () => {
  it('stores a Workspace and a Trading Partner in the migrated schema', async () => {
    const [workspace] = await database.db
      .insert(workspaces)
      .values({ name: 'Nordwind Foods', gln: '4006381333931' })
      .returning()

    const [tradingPartner] = await database.db
      .insert(tradingPartners)
      .values({
        workspaceId: workspace!.id,
        name: 'Hanse Retail',
        gln: null,
        characterSet: 'UNOC',
        acknowledgementTimeLimitHours: 24,
      })
      .returning()

    expect(tradingPartner).toMatchObject({
      workspaceId: workspace!.id,
      name: 'Hanse Retail',
      gln: null,
      characterSet: 'UNOC',
      acknowledgementTimeLimitHours: 24,
      testMode: true,
      testInterchangeSentAt: null,
      contrlReceivedAt: null,
    })
  })

  it('rejects a Trading Partner without an existing Workspace', async () => {
    await expect(
      database.db.insert(tradingPartners).values({
        workspaceId: '00000000-0000-4000-8000-000000000000',
        name: 'Hanse Retail',
        gln: null,
        characterSet: 'UNOC',
        acknowledgementTimeLimitHours: 24,
      }),
    ).rejects.toThrow()
  })

  it('applies again without changes to an up-to-date database', async () => {
    await expect(migrate(testDatabase.url)).resolves.toBeUndefined()
  })
})
