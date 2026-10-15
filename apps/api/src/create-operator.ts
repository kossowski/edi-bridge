import { createInterface } from 'node:readline/promises'
import { Writable } from 'node:stream'
import { parseArgs } from 'node:util'
import { z } from 'zod'

import { connect, localDatabaseUrl, migrate } from '@edi-bridge/db'

import { ensureOperator, type OperatorOutcome } from './operator.js'

const usage =
  'Usage: create-operator --email <email> --name <name> --workspace <Workspace name> [--reset-password]'

const { values } = parseArgs({
  options: {
    email: { type: 'string' },
    name: { type: 'string' },
    workspace: { type: 'string' },
    'reset-password': { type: 'boolean', default: false },
  },
})

const env = z
  .object({
    DATABASE_URL: z.url().default(localDatabaseUrl),
    OPERATOR_PASSWORD: z.string().optional(),
  })
  .safeParse(process.env)

if (!env.success) {
  throw new Error(`Invalid environment configuration:\n${z.prettifyError(env.error)}`)
}

const { email, name, workspace } = values

if (email === undefined || name === undefined || workspace === undefined) {
  console.error(usage)
  process.exit(1)
}

async function promptPassword() {
  if (!process.stdin.isTTY) {
    throw new Error('Set OPERATOR_PASSWORD or run the command in a terminal to enter the password.')
  }

  let muted = false

  const output = new Writable({
    write(chunk: Buffer, _encoding, done) {
      if (!muted) {
        process.stdout.write(chunk)
      }

      done()
    },
  })

  const prompt = createInterface({ input: process.stdin, output, terminal: true })

  try {
    const answer = prompt.question('Password: ')

    muted = true

    return await answer
  } finally {
    prompt.close()
    process.stdout.write('\n')
  }
}

const summary = (outcome: OperatorOutcome) =>
  [
    `User ${outcome.email}: ${outcome.user}`,
    `Workspace "${workspace}": ${outcome.workspace}`,
    `Operator: ${outcome.operatorGranted ? 'granted' : 'already granted'}`,
    `Admin of the Workspace: ${outcome.adminGranted ? 'granted' : 'already granted'}`,
    `Password: ${outcome.user === 'created' ? 'set' : outcome.passwordReset ? 'reset' : 'unchanged'}`,
  ].join('\n')

await migrate(env.data.DATABASE_URL)

const connection = connect(env.data.DATABASE_URL)

try {
  const password = env.data.OPERATOR_PASSWORD

  const outcome = await ensureOperator(
    connection.db,
    { email, name, workspaceName: workspace, resetPassword: values['reset-password'] },
    () => (password === undefined ? promptPassword() : Promise.resolve(password)),
  )

  console.log(summary(outcome))
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
} finally {
  await connection.close()
}
