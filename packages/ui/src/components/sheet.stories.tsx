import type { Meta, StoryObj } from '@storybook/react'

import { Button } from '@edi-bridge/ui/components/button'
import { Input } from '@edi-bridge/ui/components/input'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@edi-bridge/ui/components/sheet'

import { expectFocusTrapped, findOpenDialog } from '../stories/checks'

const meta = {
  title: 'UI/Sheet',
  component: Sheet,
  render: () => (
    <div className="flex gap-2 p-4">
      <Button variant="outline">Before</Button>
      <Sheet>
        <SheetTrigger render={<Button />}>Upload a document</SheetTrigger>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Upload a document</SheetTitle>
            <SheetDescription>Hand in a document by hand.</SheetDescription>
          </SheetHeader>
          <div className="px-4">
            <Input aria-label="Order number" />
          </div>
          <SheetFooter>
            <Button>Upload</Button>
            <Button variant="outline">Cancel</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
      <Button variant="outline">After</Button>
    </div>
  ),
  // The sheet renders in a portal outside the story root.
  parameters: { a11y: { context: 'body' } },
} satisfies Meta<typeof Sheet>

export default meta

type Story = StoryObj<typeof meta>

export const FocusStaysInside: Story = {
  async play({ canvas, canvasElement, userEvent }) {
    await userEvent.click(canvas.getByRole('button', { name: 'Upload a document' }))

    await expectFocusTrapped(await findOpenDialog(canvasElement, 'Upload a document'), userEvent)
  },
}
