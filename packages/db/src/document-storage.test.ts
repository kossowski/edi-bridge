import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { connect, type Connection } from './client.js'
import { type DocumentStorage, postgresDocumentStorage } from './document-storage.js'
import { channels, documents, workspaces } from './schema.js'
import { startTestDatabase, type TestDatabase } from './testing.js'

let testDatabase: TestDatabase

let connection: Connection

let storage: DocumentStorage

let workspaceId: string

let channelId: string

async function insertWorkspace(name: string) {
  const [workspace] = await connection.db
    .insert(workspaces)
    .values({ name })
    .returning({ id: workspaces.id })

  if (workspace === undefined) {
    throw new Error('Workspace insert returned no row')
  }

  const [channel] = await connection.db
    .insert(channels)
    .values({
      workspaceId: workspace.id,
      type: 'webhook',
      direction: 'inbound',
      name: 'ERP webhook',
      rateLimitPerMinute: 60,
      encryptedWebhookToken: 'encrypted',
      webhookTokenLastFour: 'abcd',
    })
    .returning({ id: channels.id })

  if (channel === undefined) {
    throw new Error('Channel insert returned no row')
  }

  return { workspaceId: workspace.id, channelId: channel.id }
}

beforeAll(async () => {
  testDatabase = await startTestDatabase()
  connection = connect(testDatabase.url)
  storage = postgresDocumentStorage(connection.db)
  ;({ workspaceId, channelId } = await insertWorkspace('Nordwind Foods'))
}, 60_000)

afterAll(async () => {
  await connection.close()
  await testDatabase.stop()
})

const invoice =
  "UNA:+.? 'UNB+UNOC:3+4012345000009:14+4000001000005:14+261014:1200+1'UNH+1+INVOIC:D:96A:UN:EAN008'BGM+380+INV-1001?+A+9'UNT+3+1'UNZ+1+1'"

describe('the Document storage', () => {
  it('reads back a stored Document unmodified', async () => {
    const stored = await storage.store({
      workspaceId,
      channelId,
      fileName: 'invoice.edi',
      content: invoice,
      interchangeSender: '4012345000009',
      interchangeControlReference: '1',
      testIndicator: true,
      contentHash: 'a1b2',
    })

    await expect(storage.read(workspaceId, stored.id)).resolves.toEqual({
      id: stored.id,
      workspaceId,
      channelId,
      fileName: 'invoice.edi',
      content: invoice,
      bytes: null,
      interchangeSender: '4012345000009',
      interchangeControlReference: '1',
      testIndicator: true,
      contentHash: 'a1b2',
      receivedAt: stored.receivedAt,
    })
  })

  it('keeps characters outside ASCII', async () => {
    const content = '{"supplier":"Müller & Söhne GmbH","note":"Größe ½ – ✓"}'

    const stored = await storage.store({
      workspaceId,
      channelId,
      fileName: 'invoice.json',
      content,
    })

    await expect(storage.read(workspaceId, stored.id)).resolves.toMatchObject({ content })
  })

  it('reads back the bytes of a Document without content unmodified', async () => {
    const bytes = Buffer.from([0x4e, 0x41, 0x44, 0x2b, 0xe4, 0x00, 0xff])

    const stored = await storage.store({ workspaceId, channelId, fileName: 'orders.edi', bytes })

    await expect(storage.read(workspaceId, stored.id)).resolves.toMatchObject({
      content: null,
      bytes,
    })
  })

  it.each([
    ['content', { content: 'UNA:+.? ' }],
    ['file name', { fileName: 'renamed.edi' }],
    ['received time', { receivedAt: new Date(0) }],
  ])('refuses a change to the %s of a stored Document', async (_field, change) => {
    const stored = await storage.store({
      workspaceId,
      channelId,
      fileName: 'invoice.edi',
      content: invoice,
    })

    await expect(
      connection.db.update(documents).set(change).where(eq(documents.id, stored.id)),
    ).rejects.toThrow()
    await expect(storage.read(workspaceId, stored.id)).resolves.toEqual(stored)
  })

  it('reads nothing for an unknown id', async () => {
    await expect(
      storage.read(workspaceId, '00000000-0000-4000-8000-000000000000'),
    ).resolves.toBeUndefined()
  })

  it('reads nothing for a Document of another Workspace', async () => {
    const other = await insertWorkspace('Hanse Retail')

    const stored = await storage.store({ ...other, fileName: 'invoice.edi', content: invoice })

    await expect(storage.read(workspaceId, stored.id)).resolves.toBeUndefined()
  })

  it('rejects a Document without an existing Channel', async () => {
    await expect(
      storage.store({
        workspaceId,
        channelId: '00000000-0000-4000-8000-000000000000',
        fileName: 'invoice.edi',
        content: invoice,
      }),
    ).rejects.toThrow()
  })

  it('rejects a Document without an existing Workspace', async () => {
    await expect(
      storage.store({
        workspaceId: '00000000-0000-4000-8000-000000000000',
        channelId,
        fileName: 'invoice.edi',
        content: invoice,
      }),
    ).rejects.toThrow()
  })
})
