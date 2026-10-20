import { randomBytes } from 'node:crypto'
import { z } from 'zod'

import { secretBox, secretKeyEnv } from '@edi-bridge/channels'
import { connect, localDatabaseUrl, migrate } from '@edi-bridge/db'

import {
  type ShowcaseAndSandboxOutcome,
  ensureShowcaseAndSandbox,
  sandboxWorkspace,
  showcaseAdmin,
  showcaseViewer,
  showcaseWorkspace,
} from './showcase-and-sandbox.js'

const summary = (outcome: ShowcaseAndSandboxOutcome) =>
  [
    `Showcase Workspace "${showcaseWorkspace.name}": ${outcome.showcase}`,
    `Sandbox Workspace "${sandboxWorkspace.name}": ${outcome.sandbox}`,
    `Viewer ${showcaseViewer.email} of the Showcase: ${outcome.viewer}`,
    `Admin ${showcaseAdmin.email} of the Sandbox: ${outcome.admin}`,
  ].join('\n')

async function createShowcaseAndSandbox() {
  const env = z
    .object({
      DATABASE_URL: z.url().default(localDatabaseUrl),
      CHANNEL_SECRET_KEY: secretKeyEnv(process.env.NODE_ENV === 'production'),
      SHOWCASE_ADMIN_PASSWORD: z.string().optional(),
    })
    .safeParse(process.env)

  if (!env.success) {
    throw new Error(`Invalid environment configuration:\n${z.prettifyError(env.error)}`)
  }

  const {
    DATABASE_URL: databaseUrl,
    CHANNEL_SECRET_KEY: secretKey,
    SHOWCASE_ADMIN_PASSWORD: password,
  } = env.data

  await migrate(databaseUrl)

  const connection = connect(databaseUrl)

  let generated: string | undefined

  try {
    const outcome = await ensureShowcaseAndSandbox(connection.db, {
      secrets: secretBox(secretKey),
      adminPassword: () => password ?? (generated = randomBytes(18).toString('base64url')),
    })

    console.log(summary(outcome))

    // Printed once to the terminal of this command only; the api never sees or logs it.
    if (generated !== undefined) {
      console.log(`Password of ${showcaseAdmin.email}: ${generated}`)
      console.log('Store it now: the command does not show it again.')
    }
  } finally {
    await connection.close()
  }
}

try {
  await createShowcaseAndSandbox()
} catch (error) {
  console.error(
    error instanceof Error ? error.message : 'The Showcase and Sandbox could not be created.',
  )
  process.exitCode = 1
}
