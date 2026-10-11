import type { Session } from '@edi-bridge/contracts'

export function canChange(session: Session | null | undefined) {
  return session ? session.operator || session.role === 'admin' : false
}
