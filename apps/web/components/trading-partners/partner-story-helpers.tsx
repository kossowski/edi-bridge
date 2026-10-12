import { type ReactNode } from 'react'
import { expect, waitFor, within } from 'storybook/test'

import type { StoryContext } from '@storybook/nextjs-vite'

import { AppHeader } from '@/components/app-header'
import { sessionHandlers } from '@/components/session/session-story-helpers'
import { type TradingPartner } from '@edi-bridge/contracts'
import { seedTradingPartners, showcaseViewerSession } from '@edi-bridge/mocks'
import { SidebarProvider } from '@edi-bridge/ui/components/sidebar'

export function seeded(name: string) {
  return seedTradingPartners.find((tradingPartner) => tradingPartner.name === name)!
}

export const live = seeded('Hansemarkt GmbH')

export const confirmed = seeded('Spreewald Frische GmbH')

export const awaiting = seeded('Bodensee Handelshaus AG')

export const untouched = seeded('Mainfranken Getränke GmbH')

export const withoutGln = seeded('Ostsee Feinkost GmbH')

export function at(tradingPartner: TradingPartner, tab?: string) {
  return {
    args: { id: tradingPartner.id },
    parameters: {
      nextjs: {
        navigation: {
          pathname: `/trading-partners/${tradingPartner.id}`,
          query: tab ? { tab } : {},
        },
      },
    },
  }
}

export function asViewer(play: (context: StoryContext) => Promise<void>) {
  return {
    beforeEach({ msw }: StoryContext) {
      msw.use(...sessionHandlers(showcaseViewerSession))
    },
    async play(context: StoryContext) {
      await expect(await context.canvas.findByText('View only')).toBeVisible()
      await play(context)
    },
  }
}

// Waits out the opening fade, so visibility checks see the settled sheet or dialog.
export async function sheetOf(
  canvasElement: HTMLElement,
  name: string | RegExp = 'Add a connection',
  role: 'dialog' | 'alertdialog' = 'dialog',
) {
  const element = await within(canvasElement.ownerDocument.body).findByRole(role, { name })
  await waitFor(() => expect(element).toBeVisible())

  return element
}

export const withPartnerFrame = (Story: () => ReactNode) => (
  <SidebarProvider>
    <div className="w-full">
      <AppHeader />
      <Story />
    </div>
  </SidebarProvider>
)
