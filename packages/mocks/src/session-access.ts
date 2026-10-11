import type { HttpResponseResolver, PathParams } from 'msw'

import type { Session } from '@edi-bridge/contracts'

import { forbidden, unauthorized } from './responses'

export type SessionStore = {
  get: () => Session | null
  set: (session: Session | null) => void
}

export function sessionStoreOf(session: Session | null | SessionStore): SessionStore {
  if (session !== null && 'get' in session) {
    return session
  }

  let current = session

  return {
    get: () => current,
    set: (next) => {
      current = next
    },
  }
}

type SessionResolver<Params extends PathParams<keyof Params>> = (
  info: Parameters<HttpResponseResolver<Params>>[0],
  session: Session,
) => ReturnType<HttpResponseResolver<Params>>

function guarded<Params extends PathParams<keyof Params>>(
  store: SessionStore,
  allowed: (session: Session) => boolean,
  resolver: SessionResolver<Params>,
): HttpResponseResolver<Params> {
  return (info) => {
    const session = store.get()

    if (!session) {
      return unauthorized()
    }

    return allowed(session) ? resolver(info, session) : forbidden()
  }
}

export function signedInOnly<Params extends PathParams<keyof Params>>(
  store: SessionStore,
  resolver: SessionResolver<Params>,
) {
  return guarded(store, () => true, resolver)
}

export function operatorOnly<Params extends PathParams<keyof Params>>(
  store: SessionStore,
  resolver: SessionResolver<Params>,
) {
  return guarded(store, (session) => session.operator, resolver)
}

export function adminOnly<Params extends PathParams<keyof Params>>(
  store: SessionStore,
  resolver: SessionResolver<Params>,
) {
  return guarded(store, (session) => session.operator || session.role === 'admin', resolver)
}
