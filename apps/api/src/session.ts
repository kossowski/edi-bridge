import { Effect } from 'effect'

import type { Session, SessionUser } from '@edi-bridge/contracts'

import { loadCurrentWorkspace } from './workspace.js'

// Until login (#201).
const developmentUser: SessionUser = {
  id: 'development-user',
  name: 'Development User',
  email: 'developer@edi-bridge.example',
}

export const loadDevelopmentSession = Effect.map(loadCurrentWorkspace, ({ id, name }): Session => ({
  user: developmentUser,
  operator: false,
  workspace: { id, name, kind: 'standard' },
  role: 'admin',
}))
