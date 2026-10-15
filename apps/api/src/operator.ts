import { hashPassword } from 'better-auth/crypto'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'

import { members, users, workspaces } from '@edi-bridge/db'

import { addUser, storePassword } from './user.js'

import type { Database, Transaction } from './db.js'

export interface OperatorInput {
  email: string
  name: string
  workspaceName: string
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

export async function ensureOperator(
  database: Database,
  { email: rawEmail, name, workspaceName, resetPassword = false }: OperatorInput,
  askPassword: () => Promise<string>,
): Promise<OperatorOutcome> {
  const email = z.email().parse(rawEmail.trim().toLowerCase())

  const [existing] = await database
    .select({ id: users.id, operator: users.operator })
    .from(users)
    .where(eq(users.email, email))

  const passwordHash =
    existing === undefined || resetPassword ? await hashedPassword(askPassword) : undefined

  return database.transaction(async (tx) => {
    const { id: workspaceId, outcome: workspaceOutcome } = await findOrCreateWorkspace(
      tx,
      workspaceName,
    )

    const userId = existing?.id ?? (await addUser(tx, { name, email, operator: true }))

    if (existing !== undefined && !existing.operator) {
      await tx.update(users).set({ operator: true }).where(eq(users.id, userId))
    }

    if (passwordHash !== undefined) {
      await storePassword(tx, userId, passwordHash)
    }

    return {
      email,
      user: existing === undefined ? 'created' : 'found',
      workspace: workspaceOutcome,
      operatorGranted: !existing?.operator,
      adminGranted: await grantAdmin(tx, userId, workspaceId),
      passwordReset: existing !== undefined && passwordHash !== undefined,
    }
  })
}
