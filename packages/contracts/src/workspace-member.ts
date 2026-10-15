import { z } from 'zod'

import { sessionUserSchema } from './session'
import { workspaceRoleSchema } from './workspace'

import type { Endpoint } from './endpoint'

export const workspaceMemberSchema = sessionUserSchema.extend({
  role: workspaceRoleSchema,
  lastActivityAt: z.iso.datetime().nullable(),
})

export type WorkspaceMember = z.infer<typeof workspaceMemberSchema>

export const workspaceMembersEndpoint: Endpoint<WorkspaceMember[]> = {
  method: 'GET',
  path: '/workspaces/current/members',
  response: z.array(workspaceMemberSchema),
}

export const operatorWorkspaceMembersEndpoint: Endpoint<
  WorkspaceMember[],
  undefined,
  undefined,
  '/operator/workspaces/:workspaceId/members'
> = {
  method: 'GET',
  path: '/operator/workspaces/:workspaceId/members',
  response: z.array(workspaceMemberSchema),
}

export const removeWorkspaceMemberEndpoint: Endpoint<
  undefined,
  undefined,
  undefined,
  '/operator/workspaces/:workspaceId/members/:userId'
> = {
  method: 'DELETE',
  path: '/operator/workspaces/:workspaceId/members/:userId',
  response: z.undefined(),
}
