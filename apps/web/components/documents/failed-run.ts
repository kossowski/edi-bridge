import type { RunDetail } from '@edi-bridge/contracts'

export type FailedRun = Extract<RunDetail, { status: 'failed' }>
