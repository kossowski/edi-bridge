import { hashPassword } from 'better-auth/crypto'
import { eq, sql } from 'drizzle-orm'

import { type SecretBox } from '@edi-bridge/channels'
import { minPasswordLength, type WorkspaceKind, type WorkspaceRole } from '@edi-bridge/contracts'
import { users, workspaces } from '@edi-bridge/db'

import { seedWorkspace } from './seed.js'
import { addMembership, addUser, storePassword } from './user.js'

import type { Database, Transaction } from './db.js'

export const showcaseWorkspace = { name: 'Lindenhof Feinkost GmbH', kind: 'showcase' } as const

export const sandboxWorkspace = { name: 'Kranichsee Getränke GmbH', kind: 'sandbox' } as const

export const showcaseViewer = {
  name: 'Showcase Viewer',
  email: 'showcase-viewer@edi-bridge.example',
} as const

export const showcaseAdmin = {
  name: 'Showcase Admin',
  email: 'showcase-admin@edi-bridge.example',
} as const

export interface DemoWorkspacesInput {
  secrets: SecretBox
  adminPassword: () => string
  now?: Date
}

type Outcome = 'created' | 'found'

export interface DemoWorkspacesOutcome {
  showcase: Outcome
  sandbox: Outcome
  viewer: Outcome
  admin: Outcome
}

async function ensureWorkspace(
  tx: Transaction,
  { name, kind }: { name: string; kind: WorkspaceKind },
  { secrets, now }: { secrets: SecretBox; now: Date },
) {
  const [found] = await tx
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(eq(workspaces.kind, kind))

  if (found !== undefined) {
    return { id: found.id, outcome: 'found' as const }
  }

  const [created] = await tx
    .insert(workspaces)
    .values({ name, kind })
    .returning({ id: workspaces.id })

  if (created === undefined) {
    throw new Error('Workspace insert returned no row')
  }

  await seedWorkspace(tx, created.id, { secrets, now })

  return { id: created.id, outcome: 'created' as const }
}

async function ensureMember(
  tx: Transaction,
  { name, email }: { name: string; email: string },
  membership: { workspaceId: string; role: WorkspaceRole },
  passwordHash?: () => Promise<string>,
) {
  const [found] = await tx.select({ id: users.id }).from(users).where(eq(users.email, email))

  if (found !== undefined) {
    return 'found' as const
  }

  const userId = await addUser(tx, { name, email, operator: false })

  if (passwordHash !== undefined) {
    await storePassword(tx, userId, await passwordHash())
  }

  await addMembership(tx, { userId, ...membership })

  return 'created' as const
}

async function hashedAdminPassword(adminPassword: () => string) {
  const password = adminPassword()

  if (password.length < minPasswordLength) {
    throw new Error(`The password must have at least ${minPasswordLength} characters.`)
  }

  return hashPassword(password)
}

export function ensureDemoWorkspaces(
  database: Database,
  { secrets, adminPassword, now = new Date() }: DemoWorkspacesInput,
): Promise<DemoWorkspacesOutcome> {
  return database.transaction(async (tx) => {
    // The lock keeps two runs of the command from creating a second Showcase or Sandbox.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('workspaces.demo'))`)

    const showcase = await ensureWorkspace(tx, showcaseWorkspace, { secrets, now })
    const sandbox = await ensureWorkspace(tx, sandboxWorkspace, { secrets, now })

    // The Viewer gets no password: only the showcase sign-in creates their session.
    const viewer = await ensureMember(tx, showcaseViewer, {
      workspaceId: showcase.id,
      role: 'viewer',
    })

    const admin = await ensureMember(
      tx,
      showcaseAdmin,
      { workspaceId: sandbox.id, role: 'admin' },
      () => hashedAdminPassword(adminPassword),
    )

    return { showcase: showcase.outcome, sandbox: sandbox.outcome, viewer, admin }
  })
}
