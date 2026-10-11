import { expect } from 'storybook/test'

import type { RequestHandler } from 'msw'
import type { ReactNode } from 'react'
import type { StoryContext } from 'storybook/internal/csf'

import { ViewOnlyBadge } from '@/components/session/view-only-badge'
import { apiUrl } from '@/lib/api/config'
import {
  sessionHandlers as mockSessionHandlers,
  type SessionStore,
  showcaseViewerSession,
} from '@edi-bridge/mocks'

import type { Session } from '@edi-bridge/contracts'

export function sessionHandlers(session: Session | SessionStore) {
  return mockSessionHandlers(apiUrl, session)
}

const withViewOnlyBadge = (Story: () => ReactNode) => (
  <>
    <ViewOnlyBadge />
    <Story />
  </>
)

// Waiting for the badge proves the Viewer session has loaded, so absent actions are not just pending.
export function viewerStory({
  handlers = [],
  play,
}: {
  handlers?: RequestHandler[]
  play: (context: StoryContext) => Promise<void>
}) {
  return {
    beforeEach({ msw }: StoryContext) {
      msw.use(...sessionHandlers(showcaseViewerSession), ...handlers)
    },
    decorators: [withViewOnlyBadge],
    async play(context: StoryContext) {
      await expect(await context.canvas.findByText('View only')).toBeVisible()
      await play(context)
    },
  }
}
