import type { Meta, StoryObj } from '@storybook/react'

import { Button } from '@edi-bridge/ui/components/button'
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarMenu,
  SidebarInset,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from '@edi-bridge/ui/components/sidebar'

import {
  darkMode,
  expectFocusTrapped,
  expectVisibleFocusRing,
  findOpenDialog,
} from '../stories/checks'

const meta = {
  title: 'UI/Sidebar',
  component: SidebarMenuButton,
  render: () => (
    <SidebarProvider>
      <Sidebar collapsible="none">
        <SidebarContent>
          <SidebarGroup>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton>Runs</SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>
    </SidebarProvider>
  ),
} satisfies Meta<typeof SidebarMenuButton>

export default meta

type Story = StoryObj<typeof meta>

export const MenuButtonFocused: Story = {
  async play({ canvas, userEvent }) {
    await expectVisibleFocusRing(canvas.getByRole('button', { name: 'Runs' }), userEvent)
  },
}

export const MenuButtonFocusedDark: Story = { ...MenuButtonFocused, beforeEach: darkMode }

export const MobileFocusStaysInside: Story = {
  parameters: {
    viewport: {
      options: { mobile: { name: 'Mobile', styles: { width: '390px', height: '844px' } } },
    },
    // The mobile sidebar renders in a portal outside the story root.
    a11y: { context: 'body' },
  },
  globals: { viewport: { value: 'mobile', isRotated: false } },
  render: () => (
    <SidebarProvider>
      <Sidebar label="Navigation">
        <SidebarContent>
          <SidebarGroup>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton>Documents</SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton>Trading partners</SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>
      <SidebarInset className="flex-row gap-2 p-4">
        <SidebarTrigger label="Toggle sidebar" />
        <Button variant="outline">Page</Button>
      </SidebarInset>
    </SidebarProvider>
  ),
  async play({ canvas, canvasElement, userEvent }) {
    await userEvent.click(canvas.getByRole('button', { name: 'Toggle sidebar' }))

    await expectFocusTrapped(await findOpenDialog(canvasElement, 'Navigation'), userEvent)
  },
}
