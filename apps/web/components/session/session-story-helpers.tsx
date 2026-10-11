import { expect } from 'storybook/test'

import type { ReactNode } from 'react'

import { ViewOnlyBadge } from '@/components/session/view-only-badge'
import { apiUrl } from '@/lib/api/config'
import { createSessionStore, sessionHandlers, showcaseViewerSession } from '@edi-bridge/mocks'

export function viewerSessionHandlers() {
  return sessionHandlers(apiUrl, createSessionStore(showcaseViewerSession))
}

// The badge only shows once the Viewer session has loaded, so absent actions are not just pending.
export const withViewOnlyBadge = (Story: () => ReactNode) => (
  <>
    <ViewOnlyBadge />
    <Story />
  </>
)

export async function expectSignedInAsViewer(canvas: {
  findByText: (text: string) => Promise<HTMLElement>
}) {
  await expect(await canvas.findByText('View only')).toBeVisible()
}
