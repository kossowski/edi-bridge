import { eq } from 'drizzle-orm'

import { documents } from './schema.js'

import type { Connection } from './client.js'

export type RawDocument = typeof documents.$inferSelect

export type NewDocument = Pick<RawDocument, 'workspaceId' | 'fileName' | 'content'>

export interface DocumentStorage {
  store(document: NewDocument): Promise<RawDocument>
  read(id: string): Promise<RawDocument | undefined>
}

export function postgresDocumentStorage(db: Connection['db']): DocumentStorage {
  return {
    async store(document) {
      const [stored] = await db.insert(documents).values(document).returning()

      if (stored === undefined) {
        throw new Error('Document insert returned no row')
      }

      return stored
    },

    async read(id) {
      const [document] = await db.select().from(documents).where(eq(documents.id, id))

      return document
    },
  }
}
