import { z } from 'zod'

import { workspaceKindSchema, workspaceRoleSchema, workspaceSchema } from './workspace'

import type { Endpoint } from './endpoint'

export const maxWorkspaceNameLength = 70

export const workspaceSummarySchema = workspaceSchema.extend({
  kind: workspaceKindSchema,
  memberCount: z.number().int().min(0),
  seeded: z.boolean(),
  createdAt: z.iso.datetime(),
  lastResetAt: z.iso.datetime().nullable(),
})

export type WorkspaceSummary = z.infer<typeof workspaceSummarySchema>

export const operatorWorkspacesEndpoint: Endpoint<WorkspaceSummary[]> = {
  method: 'GET',
  path: '/operator/workspaces',
  response: z.array(workspaceSummarySchema),
}

export const workspaceInputSchema = z.object({
  name: z.string().trim().min(1).max(maxWorkspaceNameLength),
  seed: z.boolean(),
})

export type WorkspaceInput = z.infer<typeof workspaceInputSchema>

export const createWorkspaceEndpoint: Endpoint<
  WorkspaceSummary,
  undefined,
  WorkspaceInput,
  '/operator/workspaces'
> = {
  method: 'POST',
  path: '/operator/workspaces',
  body: workspaceInputSchema,
  response: workspaceSummarySchema,
}

export const inviteSchema = z.object({
  id: z.uuid(),
  workspaceId: z.uuid(),
  email: z.email(),
  role: workspaceRoleSchema,
  link: z.url({ protocol: /^https?$/ }),
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  acceptedAt: z.iso.datetime().nullable(),
})

export type Invite = z.infer<typeof inviteSchema>

export const inviteValidityDays = 7

export const workspaceInvitesEndpoint: Endpoint<
  Invite[],
  undefined,
  undefined,
  '/operator/workspaces/:workspaceId/invites'
> = {
  method: 'GET',
  path: '/operator/workspaces/:workspaceId/invites',
  response: z.array(inviteSchema),
}

export const inviteInputSchema = z.object({
  email: z.email(),
  role: workspaceRoleSchema,
})

export type InviteInput = z.infer<typeof inviteInputSchema>

export const createInviteEndpoint: Endpoint<
  Invite,
  undefined,
  InviteInput,
  '/operator/workspaces/:workspaceId/invites'
> = {
  method: 'POST',
  path: '/operator/workspaces/:workspaceId/invites',
  body: inviteInputSchema,
  response: inviteSchema,
}

export const resetSandboxWorkspaceEndpoint: Endpoint<
  WorkspaceSummary,
  undefined,
  undefined,
  '/operator/workspaces/:workspaceId/reset'
> = {
  method: 'POST',
  path: '/operator/workspaces/:workspaceId/reset',
  response: workspaceSummarySchema,
}
