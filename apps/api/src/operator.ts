import { hashPassword } from 'better-auth/crypto'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'

import { accounts, members, users, workspaces } from '@edi-bridge/db'

import type { Database, Transaction } from './db.js'

export interface OperatorInput {
  email: string
  name: string
  workspace: string
  resetPassword?: boolean
}

export interface OperatorOutcome {
  email: string
  user: 'created' | 'found'
  workspace: 'created' | 'found'
  operatorGranted: boolean
  adminGranted: boolean
  passwordReset: boolean
}

const minPasswordLength = 8

const credentialProvider = 'credential'

async function hashedPassword(askPassword: () => Promise<string>) {
  const password = await askPassword()

  if (password.length < minPasswordLength) {
    throw new Error(`The password must have at least ${minPasswordLength} characters.`)
  }

  return hashPassword(password)
}

async function findOrCreateWorkspace(tx: Transaction, name: string) {
  const found = await tx
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(eq(workspaces.name, name))

  if (found.length > 1) {
    throw new Error(`Several Workspaces are named "${name}".`)
  }

  const [workspace] = found

  if (workspace !== undefined) {
    return { id: workspace.id, outcome: 'found' as const }
  }

  const [created] = await tx.insert(workspaces).values({ name }).returning({ id: workspaces.id })

  if (created === undefined) {
    throw new Error('Workspace insert returned no row')
  }

  return { id: created.id, outcome: 'created' as const }
}

async function grantAdmin(tx: Transaction, userId: string, workspaceId: string) {
  const [member] = await tx
    .select({ role: members.role })
    .from(members)
    .where(and(eq(members.userId, userId), eq(members.workspaceId, workspaceId)))

  if (member?.role === 'admin') {
    return false
  }

  await tx
    .insert(members)
    .values({ userId, workspaceId, role: 'admin' })
    .onConflictDoUpdate({
      target: [members.userId, members.workspaceId],
      set: { role: 'admin' },
    })

  return true
}

async function storePassword(tx: Transaction, userId: string, password: string) {
  const updated = await tx
    .update(accounts)
    .set({ password })
    .where(and(eq(accounts.userId, userId), eq(accounts.providerId, credentialProvider)))
    .returning({ id: accounts.id })

  if (updated.length === 0) {
    await tx
      .insert(accounts)
      .values({ userId, accountId: userId, providerId: credentialProvider, password })
  }
}

export async function createOperator(
  database: Database,
  { email: rawEmail, name, workspace, resetPassword = false }: OperatorInput,
  askPassword: () => Promise<string>,
): Promise<OperatorOutcome> {
  const email = z.email().parse(rawEmail.trim().toLowerCase())

  const [existing] = await database
    .select({ id: users.id, operator: users.operator })
    .from(users)
    .where(eq(users.email, email))

  const password =
    existing === undefined || resetPassword ? await hashedPassword(askPassword) : undefined

  return database.transaction(async (tx) => {
    const { id: workspaceId, outcome: workspaceOutcome } = await findOrCreateWorkspace(
      tx,
      workspace,
    )

    let userId = existing?.id

    if (userId === undefined) {
      const [created] = await tx
        .insert(users)
        .values({ name, email, emailVerified: true, operator: true })
        .returning({ id: users.id })

      if (created === undefined) {
        throw new Error('User insert returned no row')
      }

      userId = created.id
    } else if (!existing?.operator) {
      await tx.update(users).set({ operator: true }).where(eq(users.id, userId))
    }

    if (password !== undefined) {
      await storePassword(tx, userId, password)
    }

    return {
      email,
      user: existing === undefined ? 'created' : 'found',
      workspace: workspaceOutcome,
      operatorGranted: !existing?.operator,
      adminGranted: await grantAdmin(tx, userId, workspaceId),
      passwordReset: existing !== undefined && password !== undefined,
    }
  })
}
