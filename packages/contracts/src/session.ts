import { z } from 'zod'

import { workspaceKindSchema, workspaceRoleSchema, workspaceSchema } from './workspace'

import type { Endpoint } from './endpoint'

export const sessionUserSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  email: z.email(),
})

export type SessionUser = z.infer<typeof sessionUserSchema>

export const sessionWorkspaceSchema = workspaceSchema.pick({ id: true, name: true }).extend({
  kind: workspaceKindSchema,
})

export type SessionWorkspace = z.infer<typeof sessionWorkspaceSchema>

export const sessionSchema = z.object({
  user: sessionUserSchema,
  operator: z.boolean(),
  workspace: sessionWorkspaceSchema,
  role: workspaceRoleSchema,
})

export type Session = z.infer<typeof sessionSchema>

export const sessionEndpoint: Endpoint<Session> = {
  method: 'GET',
  path: '/session',
  response: sessionSchema,
}

export const signInBodySchema = z.object({
  email: z.email(),
  password: z.string().min(1),
})

export type SignInBody = z.infer<typeof signInBodySchema>

export const signedInSchema = z.object({ user: sessionUserSchema })

export type SignedIn = z.infer<typeof signedInSchema>

export const signInEndpoint: Endpoint<SignedIn, undefined, SignInBody, '/auth/sign-in/email'> = {
  method: 'POST',
  path: '/auth/sign-in/email',
  body: signInBodySchema,
  response: signedInSchema,
}

export const signedOutSchema = z.object({ success: z.boolean() })

export type SignedOut = z.infer<typeof signedOutSchema>

export const signOutEndpoint: Endpoint<SignedOut> = {
  method: 'POST',
  path: '/auth/sign-out',
  response: signedOutSchema,
}

export const showcaseSignInEndpoint: Endpoint<SignedIn> = {
  method: 'POST',
  path: '/auth/sign-in/showcase',
  response: signedInSchema,
}
