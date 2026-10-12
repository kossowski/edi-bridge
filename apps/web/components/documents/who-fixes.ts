import type { RunSummary } from '@edi-bridge/contracts'

export const fixers = ['partner', 'retry', 'you'] as const

export type Fixer = (typeof fixers)[number]

export function whoFixes(run: Pick<RunSummary, 'failureStage' | 'direction'>): Fixer | null {
  switch (run.failureStage) {
    case null: {
      return null
    }

    case 'delivery': {
      return 'retry'
    }

    case 'parse':
    case 'validation': {
      return run.direction === 'inbound' ? 'partner' : 'you'
    }

    case 'mapping': {
      return 'you'
    }
  }
}
