import { eq } from 'drizzle-orm'

import {
  acknowledgements,
  aiTokenUsage,
  channels,
  documentStructures,
  documents,
  flows,
  lookupTables,
  mappings,
  runs,
  tradingPartners,
  workspaces,
} from '@edi-bridge/db'

import { type SeedOptions, seedWorkspace } from './seed.js'

import type { Database, Transaction } from './db.js'

export type SandboxResetOutcome = 'reset' | 'notFound' | 'notSandbox'

async function deleteWorkspaceData(tx: Transaction, workspaceId: string) {
  // No cascade from the Workspace; Runs go first, in the order the worker locks them too.
  await tx.delete(runs).where(eq(runs.workspaceId, workspaceId))
  await tx.delete(acknowledgements).where(eq(acknowledgements.workspaceId, workspaceId))
  await tx.delete(documents).where(eq(documents.workspaceId, workspaceId))
  await tx.delete(flows).where(eq(flows.workspaceId, workspaceId))
  await tx.delete(channels).where(eq(channels.workspaceId, workspaceId))
  await tx.delete(mappings).where(eq(mappings.workspaceId, workspaceId))
  await tx.delete(documentStructures).where(eq(documentStructures.workspaceId, workspaceId))
  await tx.delete(lookupTables).where(eq(lookupTables.workspaceId, workspaceId))
  await tx.delete(tradingPartners).where(eq(tradingPartners.workspaceId, workspaceId))
  await tx.delete(aiTokenUsage).where(eq(aiTokenUsage.workspaceId, workspaceId))
}

export function resetSandbox(
  database: Database,
  workspaceId: string,
  { secrets, now = new Date() }: SeedOptions,
): Promise<SandboxResetOutcome> {
  return database.transaction(async (tx) => {
    // The lock keeps two resets of the Sandbox from seeding it twice.
    const [workspace] = await tx
      .select({ kind: workspaces.kind })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .for('update')

    if (workspace === undefined) {
      return 'notFound'
    }

    if (workspace.kind !== 'sandbox') {
      return 'notSandbox'
    }

    await deleteWorkspaceData(tx, workspaceId)
    await seedWorkspace(tx, workspaceId, { secrets, now })
    await tx.update(workspaces).set({ lastResetAt: now }).where(eq(workspaces.id, workspaceId))

    return 'reset'
  })
}

export async function findSandbox(database: Database) {
  const found = await database
    .select({ id: workspaces.id, name: workspaces.name })
    .from(workspaces)
    .where(eq(workspaces.kind, 'sandbox'))

  if (found.length > 1) {
    throw new Error('Several Sandbox Workspaces exist, so the command resets none.')
  }

  return found[0]
}

export async function resetTheSandbox(database: Database, options: SeedOptions) {
  const sandbox = await findSandbox(database)

  if (sandbox === undefined) {
    throw new Error('No Sandbox Workspace exists. Run create-demo-workspaces first.')
  }

  if ((await resetSandbox(database, sandbox.id, options)) !== 'reset') {
    throw new Error(`The Sandbox Workspace "${sandbox.name}" is gone or no longer a Sandbox.`)
  }

  return sandbox.name
}
