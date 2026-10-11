import { http, HttpResponse } from 'msw'

import {
  liveDemoSignInEndpoint,
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
  showcaseAdmin: { email: 'showcase-admin@edi-bridge.example', password: 'edi-bridge-sandbox' },
} as const

export const seedSession: Session = sessionSchema.parse({
  user: { id: seedId(9, 1), name: 'Ilka Brandt', email: mockCredentials.operator.email },
  operator: true,
  workspace: { id: seedWorkspace.id, name: seedWorkspace.name, kind: 'standard' },
  role: 'admin',
})

export const showcaseAdminSession: Session = sessionSchema.parse({
  user: { id: seedId(9, 2), name: 'Showcase Admin', email: mockCredentials.showcaseAdmin.email },
  operator: false,
  workspace: { id: seedSandboxWorkspace.id, name: seedSandboxWorkspace.name, kind: 'sandbox' },
  role: 'admin',
})

export const showcaseViewerSession: Session = sessionSchema.parse({
  user: { id: seedId(9, 3), name: 'Live demo', email: 'live-demo@edi-bridge.example' },
  operator: false,
  workspace: { id: seedShowcaseWorkspace.id, name: seedShowcaseWorkspace.name, kind: 'showcase' },
  role: 'viewer',
})

const accounts = [
  { ...mockCredentials.operator, session: seedSession },
  { ...mockCredentials.showcaseAdmin, session: showcaseAdminSession },
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

export function signedIn(store: SessionStore): { session: Session } | { response: Response } {
  const session = store.get()

  return session ? { session } : { response: unauthorized() }
}

export function signedInOperator(
  store: SessionStore,
): { session: Session } | { response: Response } {
  const result = signedIn(store)

  return 'session' in result && !result.session.operator ? { response: forbidden() } : result
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
        return HttpResponse.json({ message: 'Invalid email or password' }, { status: 401 })
      }

      return signIn(account.session)
    }),
    http.post(`${apiUrl}${liveDemoSignInEndpoint.path}`, () => signIn(showcaseViewerSession)),
    http.post(`${apiUrl}${signOutEndpoint.path}`, () => {
      store.set(null)

      return HttpResponse.json({ success: true })
    }),
  ]
}
