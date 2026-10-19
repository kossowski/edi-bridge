import type { Meta, StoryObj } from '@storybook/react'

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from '@edi-bridge/ui/components/sidebar'

import { darkMode, expectVisibleFocusRing } from '../stories/checks'

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
