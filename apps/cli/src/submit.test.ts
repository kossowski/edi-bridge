import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  addMember,
  type Client,
  signIn,
  startTestApi,
  type TestApi,
  webOrigin,
} from '@edi-bridge/api/src/testing'
import { runListSchema, runsEndpoint, toSearchParams } from '@edi-bridge/contracts'
import { golden, goldenInvoice, seedInvoiceWorkspace } from '@edi-bridge/pipeline/testing'

import { runCli } from './cli'

const member = {
  name: 'Nordwind Foods admin',
  email: 'admin@nordwind-foods.example',
  password: 'nordwind-foods-admin-password',
}

let api: TestApi

let apiUrl: string

let admin: Client

let directory: string

beforeAll(async () => {
  api = await startTestApi()

  const workspace = await seedInvoiceWorkspace(api.connection.db, 'Nordwind Foods')

  await addMember(api.connection.db, { ...member, workspaceId: workspace.id, role: 'admin' })
  admin = await signIn(api.app, member)
  apiUrl = await api.app.listen({ host: '127.0.0.1', port: 0 })
  directory = await mkdtemp(join(tmpdir(), 'edi-bridge-cli-'))
  await writeFile(join(directory, 'invoice.json'), goldenInvoice)
  await writeFile(join(directory, 'orders.edi'), golden('orders-reference.edi', 'latin1'))
}, 60_000)

afterAll(async () => {
  await rm(directory, { recursive: true, force: true })
  await api.stop()
})

async function cli(args: string[], env: Record<string, string | undefined> = {}) {
  let stdout = ''
  let stderr = ''

  const exitCode = await runCli(args, {
    cwd: directory,
    env: {
      EDI_BRIDGE_API_URL: apiUrl,
      EDI_BRIDGE_EMAIL: member.email,
      EDI_BRIDGE_PASSWORD: member.password,
      // The test API trusts the web origin, not the random port it listens on.
      EDI_BRIDGE_ORIGIN: webOrigin,
      ...env,
    },
    stdout: (text) => {
      stdout += text
    },
    stderr: (text) => {
      stderr += text
    },
  })

  return { exitCode, stdout, stderr }
}

describe('submit', () => {
  it('submits the Document as a Manual Submission on the named inbound Channel', async () => {
    const result = await cli(['submit', '--channel', 'ERP webhook', 'invoice.json'])

    expect(result.stderr).toBe('')
    expect(result.exitCode).toBe(0)

    const runId =
      /^Run ([0-9a-f-]{36}): INVOIC on Flow "Invoices to Hanse Retail", received\n$/.exec(
        result.stdout,
      )?.[1]

    expect(runId, result.stdout).toBeDefined()
    expect(api.runQueue.queued.map((run) => run.runId)).toContain(runId)

    const response = await admin.inject({
      method: 'GET',
      url: `${runsEndpoint.path}?${toSearchParams({ manualSubmission: true }).toString()}`,
    })

    expect(runListSchema.parse(response.json()).runs.map((run) => run.id)).toContain(runId)
  })

  it.each([
    [
      'the Channel name is unknown',
      ['--channel', 'Unknown', 'invoice.json'],
      'No inbound Channel is named "Unknown"',
    ],
    [
      'the Channel is outbound',
      ['--channel', 'Hanse Retail inbox', 'invoice.json'],
      'The Channel "Hanse Retail inbox" is outbound; a Document can only arrive on an inbound Channel',
    ],
    [
      'no Flow routes a Message of the Document',
      ['--channel', 'ERP webhook', 'orders.edi'],
      'POST /manual-submissions: No Flow on this Channel routes a Message of this Document',
    ],
    [
      'the file does not exist',
      ['--channel', 'ERP webhook', 'missing.json'],
      'Cannot read missing.json',
    ],
    [
      'the Channel is missing',
      ['invoice.json'],
      'Usage: submit --channel <inbound Channel name> <file>',
    ],
  ])('fails when %s', async (_, args, message) => {
    const result = await cli(['submit', ...args])

    expect(result).toMatchObject({ exitCode: 1, stdout: '' })
    expect(result.stderr).toContain(message)
  })

  it('fails when the sign-in is rejected', async () => {
    const result = await cli(['submit', '--channel', 'ERP webhook', 'invoice.json'], {
      EDI_BRIDGE_PASSWORD: 'wrong-password',
    })

    expect(result).toMatchObject({ exitCode: 1, stdout: '' })
    expect(result.stderr).toMatch(/^POST \/auth\/sign-in\/email: /)
  })
})
