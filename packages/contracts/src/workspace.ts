import { z } from 'zod'

import { glnSchema } from './gln'

import type { Endpoint } from './endpoint'

export const workspaceSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1),
  gln: glnSchema.nullable(),
})

export type Workspace = z.infer<typeof workspaceSchema>

export const currentWorkspaceEndpoint: Endpoint<Workspace> = {
  method: 'GET',
  path: '/workspaces/current',
  response: workspaceSchema,
}

export const companyIdentityInputSchema = z.object({ gln: glnSchema })

export type CompanyIdentityInput = z.infer<typeof companyIdentityInputSchema>

export const updateCompanyIdentityEndpoint: Endpoint<
  Workspace,
  undefined,
  CompanyIdentityInput,
  '/workspaces/current/identity'
> = {
  method: 'PUT',
  path: '/workspaces/current/identity',
  body: companyIdentityInputSchema,
  response: workspaceSchema,
}
