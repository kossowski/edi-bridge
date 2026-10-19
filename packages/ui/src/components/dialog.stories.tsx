import type { Meta, StoryObj } from '@storybook/react'

import { Button } from '@edi-bridge/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@edi-bridge/ui/components/dialog'

import { expectFocusTrapped, findOpenDialog } from '../testing/checks'

const meta = {
  title: 'UI/Dialog',
  component: Dialog,
  render: () => (
    <div className="flex gap-2 p-4">
      <Button variant="outline">Before</Button>
      <Dialog>
        <DialogTrigger render={<Button />}>Delete table</DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete lookup table</DialogTitle>
            <DialogDescription>The table and its values are deleted.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline">Cancel</Button>
            <Button variant="destructive">Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Button variant="outline">After</Button>
    </div>
  ),
  // The dialog renders in a portal outside the story root.
  parameters: { a11y: { context: 'body' } },
} satisfies Meta<typeof Dialog>

export default meta

type Story = StoryObj<typeof meta>

export const FocusStaysInside: Story = {
  async play({ canvas, canvasElement, userEvent }) {
    await userEvent.click(canvas.getByRole('button', { name: 'Delete table' }))

    await expectFocusTrapped(await findOpenDialog(canvasElement, 'Delete lookup table'), userEvent)
  },
}
