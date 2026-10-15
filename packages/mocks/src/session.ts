import { http, HttpResponse } from 'msw'

import {
  showcaseSignInEndpoint,
  type Session,
  sessionEndpoint,
  sessionSchema,
  signInEndpoint,
  signOutEndpoint,
} from '@edi-bridge/contracts'

import { badRequest, unauthorized } from './responses'
import { seedId } from './seed-id'
import { type SessionStore, sessionStoreOf } from './session-access'
import { seedSandboxWorkspace, seedShowcaseWorkspace, seedWorkspace } from './workspace'

import type { WorkspaceMemberStore } from './workspace-member'

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

export type Credentials = { email: string; password: string; session: Session }

export type CredentialStore = {
  find: (email: string) => Credentials | undefined
  set: (credentials: Credentials) => void
}

const seedCredentials: ReadonlyArray<Credentials> = [
  { ...mockCredentials.operator, session: seedSession },
  { ...mockCredentials.sandboxAdmin, session: sandboxAdminSession },
]

export function createCredentialStore(
  credentials: ReadonlyArray<Credentials> = seedCredentials,
): CredentialStore {
  const byEmail = new Map(credentials.map((entry) => [entry.email, entry]))

  return {
    find: (email) => byEmail.get(email),
    set: (entry) => {
      byEmail.set(entry.email, entry)
    },
  }
}

export function createSessionStore(session: Session | null = seedSession) {
  return sessionStoreOf(session)
}

export function toSessionStore(session: Session | null | SessionStore = seedSession) {
  return sessionStoreOf(session)
}

export function sessionHandlers(
  apiUrl: string,
  session: Session | null | SessionStore = seedSession,
  credentials: CredentialStore = createCredentialStore(),
  members?: Pick<WorkspaceMemberStore, 'removedFromAll'>,
) {
  const store = toSessionStore(session)
  const signedOut = (email: string) => members?.removedFromAll(email) ?? false

  function signIn(next: Session) {
    store.set(next)

    return HttpResponse.json({ user: next.user })
  }

  return [
    http.get(`${apiUrl}${sessionEndpoint.path}`, () => {
      const current = store.get()

      if (!current || signedOut(current.user.email)) {
        store.set(null)

        return unauthorized()
      }

      return HttpResponse.json(current)
    }),
    http.post(`${apiUrl}${signInEndpoint.path}`, async ({ request }) => {
      const body = signInEndpoint.body.safeParse(await request.json())

      if (!body.success) {
        return badRequest(body.error.message)
      }

      const known = credentials.find(body.data.email)

      if (known?.password !== body.data.password || signedOut(known.email)) {
        return unauthorized('Invalid email or password')
      }

      return signIn(known.session)
    }),
    http.post(`${apiUrl}${showcaseSignInEndpoint.path}`, () => signIn(showcaseViewerSession)),
    http.post(`${apiUrl}${signOutEndpoint.path}`, () => {
      store.set(null)

      return HttpResponse.json({ success: true })
    }),
  ]
}
