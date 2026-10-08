import { z } from 'zod'

import type { Endpoint } from './endpoint'

export const workspaceSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1),
})

export type Workspace = z.infer<typeof workspaceSchema>

export const currentWorkspaceEndpoint: Endpoint<Workspace> = {
  method: 'GET',
  path: '/workspaces/current',
  response: workspaceSchema,
}
