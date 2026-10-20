import { hashPassword } from 'better-auth/crypto'
import { eq, sql } from 'drizzle-orm'
import { randomBytes } from 'node:crypto'

import { type SecretBox } from '@edi-bridge/channels'
import { minPasswordLength, type WorkspaceKind, type WorkspaceRole } from '@edi-bridge/contracts'
import { members, users, workspaces } from '@edi-bridge/db'

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

export interface ShowcaseAndSandboxInput {
  secrets: SecretBox
  adminPassword: string | undefined
  now?: Date
}

type WorkspaceOutcome = 'created' | 'found'

type MemberOutcome = WorkspaceOutcome | 'membershipAdded'

export interface ShowcaseAndSandboxOutcome {
  showcase: WorkspaceOutcome
  sandbox: WorkspaceOutcome
  viewer: MemberOutcome
  admin: MemberOutcome
  generatedPassword: string | null
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

function checkedPassword(password: string) {
  if (password.length < minPasswordLength) {
    throw new Error(`The password must have at least ${minPasswordLength} characters.`)
  }

  return password
}

interface Membership {
  workspaceId: string
  role: WorkspaceRole
  label: string
}

async function ensureMember(
  tx: Transaction,
  { name, email }: { name: string; email: string },
  { label, ...membership }: Membership,
  password?: string,
): Promise<MemberOutcome> {
  const [found] = await tx
    .select({ id: users.id, operator: users.operator })
    .from(users)
    .where(eq(users.email, email))

  if (found === undefined) {
    const userId = await addUser(tx, { name, email, operator: false })

    if (password !== undefined) {
      await storePassword(tx, userId, await hashPassword(checkedPassword(password)))
    }

    await addMembership(tx, { userId, ...membership })

    return 'created'
  }

  const memberships = await tx
    .select({ workspaceId: members.workspaceId, role: members.role })
    .from(members)
    .where(eq(members.userId, found.id))

  // Every visitor shares this user, so the command never grants on top of a right it did not give.
  if (
    found.operator ||
    memberships.some(
      ({ workspaceId, role }) => workspaceId !== membership.workspaceId || role !== membership.role,
    )
  ) {
    throw new Error(
      `${email} has rights beyond the ${label}, so the command grants nothing. Remove those rights and run the command again.`,
    )
  }

  if (memberships.length > 0) {
    return 'found'
  }

  await addMembership(tx, { userId: found.id, ...membership })

  return 'membershipAdded'
}

export function ensureShowcaseAndSandbox(
  database: Database,
  { secrets, adminPassword, now = new Date() }: ShowcaseAndSandboxInput,
): Promise<ShowcaseAndSandboxOutcome> {
  return database.transaction(async (tx) => {
    // The lock keeps two runs of the command from creating a second Showcase or Sandbox.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('workspaces.showcase-and-sandbox'))`)

    const showcase = await ensureWorkspace(tx, showcaseWorkspace, { secrets, now })
    const sandbox = await ensureWorkspace(tx, sandboxWorkspace, { secrets, now })

    // The Viewer gets no password: only the Showcase sign-in creates their session.
    const viewer = await ensureMember(tx, showcaseViewer, {
      workspaceId: showcase.id,
      role: 'viewer',
      label: 'Viewer of the Showcase',
    })

    const password = adminPassword ?? randomBytes(18).toString('base64url')

    const admin = await ensureMember(
      tx,
      showcaseAdmin,
      { workspaceId: sandbox.id, role: 'admin', label: 'Admin of the Sandbox' },
      password,
    )

    return {
      showcase: showcase.outcome,
      sandbox: sandbox.outcome,
      viewer,
      admin,
      generatedPassword: admin === 'created' && adminPassword === undefined ? password : null,
    }
  })
}
