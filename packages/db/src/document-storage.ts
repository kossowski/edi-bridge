import { and, eq } from 'drizzle-orm'

import { documents } from './schema.js'

import type { Connection } from './client.js'

export type RawDocument = typeof documents.$inferSelect

export type NewDocument = Pick<RawDocument, 'workspaceId' | 'channelId' | 'fileName' | 'content'> &
  Partial<Pick<RawDocument, 'interchangeSender' | 'interchangeControlReference'>>

export interface DocumentStorage {
  store(document: NewDocument): Promise<RawDocument>
  read(workspaceId: string, id: string): Promise<RawDocument | undefined>
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

    async read(workspaceId, id) {
      const [document] = await db
        .select()
        .from(documents)
        .where(and(eq(documents.workspaceId, workspaceId), eq(documents.id, id)))

      return document
    },
  }
}
