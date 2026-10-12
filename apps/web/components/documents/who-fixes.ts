import type { RunSummary } from '@edi-bridge/contracts'

export type Fixer = 'partner' | 'retry' | 'you'

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
