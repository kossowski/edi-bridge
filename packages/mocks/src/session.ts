import { http, HttpResponse, type HttpResponseResolver, type PathParams } from 'msw'

import {
  showcaseSignInEndpoint,
  type Session,
  sessionEndpoint,
  sessionSchema,
  signInEndpoint,
  signOutEndpoint,
} from '@edi-bridge/contracts'

import { badRequest, forbidden, unauthorized } from './responses'
import { seedId } from './seed-id'
import { seedSandboxWorkspace, seedShowcaseWorkspace, seedWorkspace } from './workspace'

export const mockCredentials = {
  operator: { email: 'operator@edi-bridge.example', password: 'edi-bridge-operator' },
  sandboxAdmin: { email: 'showcase-admin@edi-bridge.example', password: 'edi-bridge-sandbox' },
} as const

export const seedSession: Session = sessionSchema.parse({
  user: { id: seedId(9, 1), name: 'Ilka Brandt', email: mockCredentials.operator.email },
  operator: true,
  workspace: { id: seedWorkspace.id, name: seedWorkspace.name, kind: 'standard' },
  role: 'admin',
})

export const sandboxAdminSession: Session = sessionSchema.parse({
  user: { id: seedId(9, 2), name: 'Showcase Admin', email: mockCredentials.sandboxAdmin.email },
  operator: false,
  workspace: { id: seedSandboxWorkspace.id, name: seedSandboxWorkspace.name, kind: 'sandbox' },
  role: 'admin',
})

export const showcaseViewerSession: Session = sessionSchema.parse({
  user: { id: seedId(9, 3), name: 'Showcase Viewer', email: 'showcase-viewer@edi-bridge.example' },
  operator: false,
  workspace: { id: seedShowcaseWorkspace.id, name: seedShowcaseWorkspace.name, kind: 'showcase' },
  role: 'viewer',
})

const accounts = [
  { ...mockCredentials.operator, session: seedSession },
  { ...mockCredentials.sandboxAdmin, session: sandboxAdminSession },
]

export type SessionStore = {
  get: () => Session | null
  set: (session: Session | null) => void
}

export function createSessionStore(session: Session | null = seedSession): SessionStore {
  let current = session

  return {
    get: () => current,
    set: (next) => {
      current = next
    },
  }
}

export function toSessionStore(session: Session | null | SessionStore = seedSession) {
  return session !== null && 'get' in session ? session : createSessionStore(session)
}

function guarded<Params extends PathParams<keyof Params>>(
  store: SessionStore,
  allowed: (session: Session) => boolean,
  resolver: HttpResponseResolver<Params>,
): HttpResponseResolver<Params> {
  return (info) => {
    const session = store.get()

    if (!session) {
      return unauthorized()
    }

    return allowed(session) ? resolver(info) : forbidden()
  }
}

export function signedInOnly<Params extends PathParams<keyof Params>>(
  store: SessionStore,
  resolver: HttpResponseResolver<Params>,
) {
  return guarded(store, () => true, resolver)
}

export function operatorOnly<Params extends PathParams<keyof Params>>(
  store: SessionStore,
  resolver: HttpResponseResolver<Params>,
) {
  return guarded(store, (session) => session.operator, resolver)
}

export function adminOnly<Params extends PathParams<keyof Params>>(
  store: SessionStore,
  resolver: HttpResponseResolver<Params>,
) {
  return guarded(store, (session) => session.operator || session.role === 'admin', resolver)
}

export function sessionHandlers(
  apiUrl: string,
  session: Session | null | SessionStore = seedSession,
) {
  const store = toSessionStore(session)

  function signIn(next: Session) {
    store.set(next)

    return HttpResponse.json({ user: next.user })
  }

  return [
    http.get(`${apiUrl}${sessionEndpoint.path}`, () => {
      const current = store.get()

      return current ? HttpResponse.json(current) : unauthorized()
    }),
    http.post(`${apiUrl}${signInEndpoint.path}`, async ({ request }) => {
      const body = signInEndpoint.body.safeParse(await request.json())

      if (!body.success) {
        return badRequest(body.error.message)
      }

      const account = accounts.find(
        ({ email, password }) => email === body.data.email && password === body.data.password,
      )

      if (!account) {
        return unauthorized('Invalid email or password')
      }

      return signIn(account.session)
    }),
    http.post(`${apiUrl}${showcaseSignInEndpoint.path}`, () => signIn(showcaseViewerSession)),
    http.post(`${apiUrl}${signOutEndpoint.path}`, () => {
      store.set(null)

      return HttpResponse.json({ success: true })
    }),
  ]
}
