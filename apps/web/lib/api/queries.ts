import { queryOptions } from '@tanstack/react-query'

import { getCurrentWorkspace } from './client'

export const currentWorkspaceQuery = queryOptions({
  queryKey: ['workspaces', 'current'],
  queryFn: getCurrentWorkspace,
})
