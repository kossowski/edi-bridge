import { expect } from 'storybook/test'

import type {
  Decorator,
  ReactRenderer,
  StoryContext as ReactStoryContext,
} from '@storybook/nextjs-vite'
import type { RequestHandler } from 'msw'
import type { BeforeEach } from 'storybook/internal/csf'

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

const withViewOnlyBadge: Decorator = (Story) => (
  <>
    <ViewOnlyBadge />
    <Story />
  </>
)

// Waiting for the badge proves the Viewer session has loaded, so absent actions are not just pending.
export function viewerStory({
  handlers = [],
  decorators = [],
  beforeEach,
  play,
}: {
  handlers?: RequestHandler[]
  decorators?: Decorator[]
  beforeEach?: BeforeEach<ReactRenderer>
  play: (context: ReactStoryContext) => Promise<void>
}) {
  return {
    beforeEach(context: ReactStoryContext) {
      context.msw.use(...sessionHandlers(showcaseViewerSession), ...handlers)

      return beforeEach?.(context)
    },
    decorators: [...decorators, withViewOnlyBadge],
    async play(context: ReactStoryContext) {
      await expect(await context.canvas.findByText('View only')).toBeVisible()
      await play(context)
    },
  }
}
