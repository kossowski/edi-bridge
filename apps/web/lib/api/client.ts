import { currentWorkspaceEndpoint, type Endpoint } from '@edi-bridge/contracts'

import { apiUrl, isMockingEnabled } from './config'

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
  ) {
    super(`API request to ${path} failed with status ${status}`)
    this.name = 'ApiError'
  }
}

let mockingStarted: Promise<void> | undefined

async function request<Response>(endpoint: Endpoint<Response>): Promise<Response> {
  if (isMockingEnabled && typeof window !== 'undefined') {
    mockingStarted ??= import('./mock-worker').then(({ startMockWorker }) => startMockWorker())
    await mockingStarted
  }

  const response = await fetch(`${apiUrl}${endpoint.path}`, { method: endpoint.method })

  if (!response.ok) {
    throw new ApiError(response.status, endpoint.path)
  }

  return endpoint.response.parse(await response.json())
}

export function getCurrentWorkspace() {
  return request(currentWorkspaceEndpoint)
}
