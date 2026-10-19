import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { connect, type Connection } from './client.js'
import { type DocumentStorage, postgresDocumentStorage } from './document-storage.js'
import { workspaces } from './schema.js'
import { startTestDatabase, type TestDatabase } from './testing.js'

let testDatabase: TestDatabase

let connection: Connection

let storage: DocumentStorage

let workspaceId: string

beforeAll(async () => {
  testDatabase = await startTestDatabase()
  connection = connect(testDatabase.url)
  storage = postgresDocumentStorage(connection.db)

  const [workspace] = await connection.db
    .insert(workspaces)
    .values({ name: 'Nordwind Foods' })
    .returning({ id: workspaces.id })

  if (workspace === undefined) {
    throw new Error('Workspace insert returned no row')
  }

  workspaceId = workspace.id
}, 60_000)

afterAll(async () => {
  await connection.close()
  await testDatabase.stop()
})

const invoice =
  "UNA:+.? 'UNB+UNOC:3+4012345000009:14+4000001000005:14+261014:1200+1'UNH+1+INVOIC:D:96A:UN:EAN008'BGM+380+INV-1001?+A+9'UNT+3+1'UNZ+1+1'"

describe('the Document storage', () => {
  it('reads back a stored Document unmodified', async () => {
    const stored = await storage.store({ workspaceId, fileName: 'invoice.edi', content: invoice })

    await expect(storage.read(stored.id)).resolves.toEqual({
      id: stored.id,
      workspaceId,
      fileName: 'invoice.edi',
      content: invoice,
      receivedAt: stored.receivedAt,
    })
  })

  it('keeps characters outside ASCII', async () => {
    const content = '{"supplier":"Müller & Söhne GmbH","note":"Größe ½ – ✓"}'

    const stored = await storage.store({ workspaceId, fileName: 'invoice.json', content })

    await expect(storage.read(stored.id)).resolves.toMatchObject({ content })
  })

  it('reads nothing for an unknown id', async () => {
    await expect(storage.read('00000000-0000-4000-8000-000000000000')).resolves.toBeUndefined()
  })

  it('rejects a Document without an existing Workspace', async () => {
    await expect(
      storage.store({
        workspaceId: '00000000-0000-4000-8000-000000000000',
        fileName: 'invoice.edi',
        content: invoice,
      }),
    ).rejects.toThrow()
  })
})
