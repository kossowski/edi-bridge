import { z } from 'zod'

import { secretBox, secretKeyEnv } from '@edi-bridge/channels'
import { connect, localDatabaseUrl, migrate } from '@edi-bridge/db'

import { findSandbox, resetSandbox } from './sandbox-reset.js'

async function resetTheSandbox() {
  const env = z
    .object({
      DATABASE_URL: z.url().default(localDatabaseUrl),
      CHANNEL_SECRET_KEY: secretKeyEnv(process.env.NODE_ENV === 'production'),
    })
    .safeParse(process.env)

  if (!env.success) {
    throw new Error(`Invalid environment configuration:\n${z.prettifyError(env.error)}`)
  }

  const { DATABASE_URL: databaseUrl, CHANNEL_SECRET_KEY: secretKey } = env.data

  await migrate(databaseUrl)

  const connection = connect(databaseUrl)

  try {
    const sandbox = await findSandbox(connection.db)

    if (sandbox === undefined) {
      throw new Error('No Sandbox Workspace exists. Run create-demo-workspaces first.')
    }

    const outcome = await resetSandbox(connection.db, sandbox.id, { secrets: secretBox(secretKey) })

    if (outcome !== 'reset') {
      throw new Error(`The Sandbox Workspace "${sandbox.name}" is gone or no longer a Sandbox.`)
    }

    console.log(`Sandbox Workspace "${sandbox.name}": reset to its seed`)
  } finally {
    await connection.close()
  }
}

try {
  await resetTheSandbox()
} catch (error) {
  console.error(error instanceof Error ? error.message : 'The Sandbox could not be reset.')
  process.exitCode = 1
}
