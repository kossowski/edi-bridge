import { createAnthropic } from '@ai-sdk/anthropic'
import { z } from 'zod'

import type { LanguageModel } from 'ai'

// The only module that knows the provider: switching it changes this file and its env vars.
const envSchema = z.object({
  ANTHROPIC_API_KEY: z.string().min(1).optional().catch(undefined),
  AI_MODEL: z.string().min(1).default('claude-sonnet-5-5'),
})

export function aiModelFromEnv(source: NodeJS.ProcessEnv): LanguageModel | null {
  const { ANTHROPIC_API_KEY: apiKey, AI_MODEL: modelId } = envSchema.parse(source)

  return apiKey === undefined ? null : createAnthropic({ apiKey })(modelId)
}
