import { and, eq } from 'drizzle-orm'

import { accounts, users } from '@edi-bridge/db'

import type { Database, Transaction } from './db.js'

export interface NewUser {
  name: string
  email: string
  operator: boolean
}

const credentialProvider = 'credential'

export async function addUser(
  database: Database | Transaction,
  { name, email, operator }: NewUser,
) {
  const [user] = await database
    .insert(users)
    .values({ name, email, emailVerified: true, operator })
    .returning({ id: users.id })

  if (user === undefined) {
    throw new Error('User insert returned no row')
  }

  return user.id
}

export async function storePassword(
  database: Database | Transaction,
  userId: string,
  passwordHash: string,
) {
  const updated = await database
    .update(accounts)
    .set({ password: passwordHash })
    .where(and(eq(accounts.userId, userId), eq(accounts.providerId, credentialProvider)))
    .returning({ id: accounts.id })

  if (updated.length === 0) {
    await database.insert(accounts).values({
      userId,
      accountId: userId,
      providerId: credentialProvider,
      password: passwordHash,
    })
  }
}
