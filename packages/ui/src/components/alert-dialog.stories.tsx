import type { Meta, StoryObj } from '@storybook/react'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@edi-bridge/ui/components/alert-dialog'
import { Button } from '@edi-bridge/ui/components/button'

import { expectFocusTrapped, findOpenDialog } from '../testing/checks'

const meta = {
  title: 'UI/AlertDialog',
  component: AlertDialog,
  render: () => (
    <div className="flex gap-2 p-4">
      <Button variant="outline">Before</Button>
      <AlertDialog>
        <AlertDialogTrigger render={<Button />}>Discard changes</AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard unsaved changes</AlertDialogTitle>
            <AlertDialogDescription>The changes to the mapping are lost.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction variant="destructive">Discard</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <Button variant="outline">After</Button>
    </div>
  ),
  // The alert dialog renders in a portal outside the story root.
  parameters: { a11y: { context: 'body' } },
} satisfies Meta<typeof AlertDialog>

export default meta

type Story = StoryObj<typeof meta>

export const FocusStaysInside: Story = {
  async play({ canvas, canvasElement, userEvent }) {
    await userEvent.click(canvas.getByRole('button', { name: 'Discard changes' }))

    await expectFocusTrapped(
      await findOpenDialog(canvasElement, 'Discard unsaved changes', 'alertdialog'),
      userEvent,
    )
  },
}
