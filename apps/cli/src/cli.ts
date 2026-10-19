import { readFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { parseArgs, TextDecoder } from 'node:util'
import { z } from 'zod'

import type { ManualSubmission } from '@edi-bridge/contracts'

import { ApiError, apiClient } from './api-client'

export interface CliContext {
  cwd: string
  env: Record<string, string | undefined>
  stdout: (text: string) => void
  stderr: (text: string) => void
}

class CliError extends Error {}

const usage = 'Usage: submit --channel <inbound Channel name> [--encoding <label>] <file>'

const envSchema = z.object({
  EDI_BRIDGE_API_URL: z.url().default('http://localhost:3001'),
  EDI_BRIDGE_EMAIL: z.email(),
  EDI_BRIDGE_PASSWORD: z.string().min(1),
  EDI_BRIDGE_ORIGIN: z.url().optional(),
  // pnpm runs the script in apps/cli; INIT_CWD is the directory it was started from.
  INIT_CWD: z.string().min(1).optional(),
})

function parseOptions(args: string[]) {
  try {
    return parseArgs({
      args,
      options: {
        channel: { type: 'string' },
        encoding: { type: 'string', default: 'utf-8' },
      },
      allowPositionals: true,
    })
  } catch (error) {
    throw new CliError(`${error instanceof Error ? error.message : String(error)}\n${usage}`)
  }
}

function parseSubmitArgs(args: string[]) {
  const [command, ...rest] = args

  if (command !== 'submit') {
    throw new CliError(usage)
  }

  const parsed = parseOptions(rest)

  const { channel, encoding } = parsed.values
  const [file, ...extra] = parsed.positionals

  if (channel === undefined || file === undefined || extra.length > 0) {
    throw new CliError(usage)
  }

  return { channel, encoding: decoderFor(encoding), file }
}

// fatal: a byte the encoding doesn't define fails instead of becoming U+FFFD.
function decoderFor(encoding: string) {
  try {
    return new TextDecoder(encoding, { fatal: true })
  } catch (error) {
    if (error instanceof RangeError) {
      throw new CliError(
        `Unknown encoding "${encoding}"; name a WHATWG encoding label such as utf-8, iso-8859-1 or windows-1252`,
      )
    }

    throw error
  }
}

async function readDocument(path: string, file: string, decoder: TextDecoder) {
  let bytes: Buffer

  try {
    bytes = await readFile(path)
  } catch (error) {
    throw new CliError(`Cannot read ${file}`, { cause: error })
  }

  try {
    return decoder.decode(bytes)
  } catch (error) {
    if (error instanceof TypeError) {
      throw new CliError(
        `${file} is not valid ${decoder.encoding}; name its encoding with --encoding`,
      )
    }

    throw error
  }
}

function formatSubmission({ runs, notRouted }: ManualSubmission) {
  const lines = runs.map((run) => {
    const outcome = run.status === 'failed' ? `failed at ${run.failureStage}` : run.status

    return `Run ${run.id}: ${run.messageType} on Flow "${run.flow.name}", ${outcome}`
  })

  for (const { messageType } of notRouted) {
    lines.push(`Not routed: ${messageType}`)
  }

  return `${lines.join('\n')}\n`
}

async function submit(args: string[], context: CliContext) {
  const { channel: channelName, encoding, file } = parseSubmitArgs(args)
  const env = envSchema.safeParse(context.env)

  if (!env.success) {
    throw new CliError(`Invalid environment:\n${z.prettifyError(env.error)}`)
  }

  const path = resolve(env.data.INIT_CWD ?? context.cwd, file)
  const content = await readDocument(path, file, encoding)

  const api = apiClient(
    env.data.EDI_BRIDGE_API_URL,
    env.data.EDI_BRIDGE_ORIGIN ?? new URL(env.data.EDI_BRIDGE_API_URL).origin,
  )

  await api.signIn({ email: env.data.EDI_BRIDGE_EMAIL, password: env.data.EDI_BRIDGE_PASSWORD })

  const named = (await api.channels()).filter((candidate) => candidate.name === channelName)
  const inbound = named.filter((candidate) => candidate.direction === 'inbound')
  const [channel] = inbound

  if (channel === undefined) {
    throw new CliError(
      named.length === 0
        ? `No inbound Channel is named "${channelName}"`
        : `The Channel "${channelName}" is outbound; a Document can only arrive on an inbound Channel`,
    )
  }

  if (inbound.length > 1) {
    throw new CliError(`Several inbound Channels are named "${channelName}"`)
  }

  const submission = await api.submitDocument({
    channelId: channel.id,
    document: { fileName: basename(path), content },
  })

  context.stdout(formatSubmission(submission))
}

export async function runCli(args: string[], context: CliContext): Promise<number> {
  try {
    await submit(args, context)

    return 0
  } catch (error) {
    if (error instanceof CliError || error instanceof ApiError) {
      const cause = error.cause instanceof Error ? `: ${error.cause.message}` : ''

      context.stderr(`${error.message}${cause}\n`)

      return 1
    }

    throw error
  }
}
