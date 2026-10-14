import { Effect } from 'effect'

import type { Channel } from '@edi-bridge/contracts'

// Until Channels are stored (#186), the Workspace has none.
export const listChannels: Effect.Effect<Channel[]> = Effect.succeed([])
