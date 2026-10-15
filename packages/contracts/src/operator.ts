import { z } from 'zod'

import { workspaceKindSchema, workspaceRoleSchema, workspaceSchema } from './workspace'

import type { Endpoint } from './endpoint'

export const maxWorkspaceNameLength = 70

export const workspaceSummarySchema = workspaceSchema.extend({
  kind: workspaceKindSchema,
  memberCount: z.number().int().min(0),
  pendingInviteCount: z.number().int().min(0),
  documentsToday: z.number().int().min(0),
  lastActivityAt: z.iso.datetime().nullable(),
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
  revokedAt: z.iso.datetime().nullable(),
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

export const revokeInviteEndpoint: Endpoint<
  Invite,
  undefined,
  undefined,
  '/operator/workspaces/:workspaceId/invites/:inviteId'
> = {
  method: 'DELETE',
  path: '/operator/workspaces/:workspaceId/invites/:inviteId',
  response: inviteSchema,
}

export const minPasswordLength = 8

export const maxPasswordLength = 128

export const maxUserNameLength = 100

export const acceptInviteInputSchema = z.object({
  token: z.string().min(1),
  name: z.string().trim().min(1).max(maxUserNameLength),
  password: z.string().min(minPasswordLength).max(maxPasswordLength),
})

export type AcceptInviteInput = z.infer<typeof acceptInviteInputSchema>

export const inviteUnusableStatus = 410

export const inviteUnusableReasonSchema = z.enum(['revoked', 'used', 'expired'])

export type InviteUnusableReason = z.infer<typeof inviteUnusableReasonSchema>

export const inviteUnusableMessages: Record<InviteUnusableReason, string> = {
  revoked: 'This invite was revoked.',
  used: 'This invite was already used.',
  expired: 'This invite has expired.',
}

type InviteTimes = {
  revokedAt: Date | string | null
  acceptedAt: Date | string | null
  expiresAt: Date | string
}

export function inviteUnusableReason(
  { revokedAt, acceptedAt, expiresAt }: InviteTimes,
  now: Date,
): InviteUnusableReason | undefined {
  if (revokedAt !== null) {
    return 'revoked'
  }

  if (acceptedAt !== null) {
    return 'used'
  }

  return new Date(expiresAt) <= now ? 'expired' : undefined
}

export const inviteUnusableProblemSchema = z.object({
  reason: inviteUnusableReasonSchema,
  message: z.string().min(1),
})

export type InviteUnusableProblem = z.infer<typeof inviteUnusableProblemSchema>

export const inviteUnusableProblem = (reason: InviteUnusableReason): InviteUnusableProblem => ({
  reason,
  message: inviteUnusableMessages[reason],
})

export const acceptedInviteSchema = z.object({ email: z.email() })

export type AcceptedInvite = z.infer<typeof acceptedInviteSchema>

export const acceptInviteEndpoint: Endpoint<
  AcceptedInvite,
  undefined,
  AcceptInviteInput,
  '/invites/accept'
> = {
  method: 'POST',
  path: '/invites/accept',
  body: acceptInviteInputSchema,
  response: acceptedInviteSchema,
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
