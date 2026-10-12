import { expect, screen, userEvent, waitFor, within } from 'storybook/test'

import { LookupTableScreen } from '@/components/code-translations/lookup-table-screen'
import { viewerStory } from '@/components/session/session-story-helpers'
import { darkMode, expectNoPageScroll, german, mobile } from '@/components/story-helpers'
import { apiUrl } from '@/lib/api/config'
import {
  createLookupTables,
  lookupTableHandlers,
  seedLookupTableNamed,
  seedLookupTables,
} from '@edi-bridge/mocks'

import preview from '../../.storybook/preview'

const unitsOfMeasure = seedLookupTableNamed('Units of measure')

const emptyTable = {
  ...unitsOfMeasure,
  id: '00000000-0000-4000-8000-0000000000e0',
  name: 'Packaging types',
  entries: [],
  upcomingCodes: [],
}

const [largeTable] = createLookupTables({
  count: 1,
  entryCount: 400,
  upcomingCodeCount: 200,
  blockingCodeCount: 120,
  seed: 11,
})

const meta = preview.meta({
  title: 'Code Translations/LookupTableScreen',
  component: LookupTableScreen,
  parameters: { layout: 'fullscreen' },
  args: { id: unitsOfMeasure.id },
  beforeEach({ msw }) {
    msw.use(...lookupTableHandlers(apiUrl, { lookupTables: [...seedLookupTables, emptyTable] }))
  },
})

function valueRow(code: string) {
  // SAFETY: every value row starts with its own code and sits in a list item.
  return within(screen.getByText(code, { selector: 'span' }).closest('li') as HTMLElement)
}

async function addForm() {
  return within(await screen.findByRole('form', { name: 'Add a value' }))
}

export const Default = meta.story({
  async play({ canvas }) {
    await expect(
      await canvas.findByRole('heading', { level: 1, name: 'Units of measure' }),
    ).toBeInTheDocument()
    await expect(canvas.getByText('Units of measure · Sent to every partner')).toBeVisible()

    const values = within(await canvas.findByRole('list', { name: 'Values (5)' }))

    await expect(values.getAllByRole('listitem')).toHaveLength(5)
    await expect(valueRow('KG').getByText('KGM')).toBeVisible()
    await expect(valueRow('KG').getByText('Kilogram')).toBeVisible()
    await expect(valueRow('KG').getByRole('button', { name: 'Edit KG' })).toBeVisible()

    const missing = within(await canvas.findByRole('region', { name: 'Not translated yet' }))
    const stopped = within(missing.getByRole('region', { name: /^Stopped documents/ }))

    await expect(stopped.getByText('KRT')).toBeVisible()
    await expect(stopped.getByText('carton')).toBeVisible()
    await expect(stopped.getAllByRole('link')[0]).toHaveAttribute(
      'href',
      expect.stringMatching(/^\/documents\/[\w-]+$/),
    )
    await expect(stopped.getByRole('button', { name: 'Add KRT' })).toBeVisible()

    const comingUp = within(missing.getByRole('region', { name: /^Coming up/ }))

    await expect(comingUp.getByText('14 items in your ERP export use it')).toBeVisible()

    const usedFor = within(canvas.getByRole('list', { name: 'Used for' }))

    await expect(usedFor.getAllByRole('link')[0]).toHaveAttribute(
      'href',
      expect.stringMatching(/^\/mappings\/[\w-]+$/),
    )
    await expect(canvas.getByRole('button', { name: 'Import CSV' })).toBeVisible()
  },
})

export const Loading = meta.story({
  beforeEach({ msw }) {
    msw.use(...lookupTableHandlers(apiUrl, { lookupTables: 'loading' }))
  },
  async play({ canvas }) {
    await expect(canvas.getByText('Loading the list')).toBeInTheDocument()
  },
})

export const Unavailable = meta.story({
  beforeEach({ msw }) {
    msw.use(...lookupTableHandlers(apiUrl, { lookupTables: 'error' }))
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('List unavailable')).toBeVisible()
  },
})

export const NotFound = meta.story({
  args: { id: '00000000-0000-4000-8000-0000000000ff' },
  async play({ canvas }) {
    await expect(await canvas.findByText('List not found')).toBeVisible()
  },
})

export const Empty = meta.story({
  args: { id: emptyTable.id },
  async play({ canvas }) {
    await expect(await canvas.findByText('No values yet')).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Add a value' })).toBeEnabled()
    await expect(canvas.queryByRole('region', { name: 'Not translated yet' })).toBeNull()
  },
})

export const LargeVolume = meta.story({
  args: { id: largeTable!.id },
  beforeEach({ msw }) {
    msw.use(...lookupTableHandlers(apiUrl, { lookupTables: [largeTable!] }))
  },
  async play({ canvas }) {
    const values = await canvas.findByRole('list', { name: 'Values (400)' }, { timeout: 10_000 })

    await expect(within(values).getAllByRole('listitem')).toHaveLength(400)

    const stopped = within(await canvas.findByRole('region', { name: 'Stopped documents (120)' }))

    await userEvent.click(stopped.getByRole('button', { name: 'Show all 120' }))
    await expect(stopped.getAllByRole('button', { name: /^Add / })).toHaveLength(120)

    await userEvent.type(canvas.getByRole('searchbox', { name: 'Find a value' }), '17')
    await expect(canvas.getByText(/^\d+ of 400 values$/)).toBeVisible()
  },
})

export const AddFromLink = meta.story({
  args: { add: 'KRT' },
  async play() {
    const form = await addForm()

    await expect(form.getByRole('textbox', { name: 'Your value' })).toHaveValue('KRT')
    await waitFor(() =>
      expect(form.getByRole('textbox', { name: 'What the partner gets' })).toHaveValue('CT'),
    )
    await expect(form.getByRole('textbox', { name: 'What the partner gets' })).toHaveFocus()
    await expect(form.getByText('CT means Carton.')).toBeVisible()

    const suggestions = within(form.getByRole('group', { name: 'Suggested codes' }))

    await expect(suggestions.getByRole('button', { name: 'CT Carton' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await userEvent.click(suggestions.getByRole('button', { name: 'PK Package' }))
    await expect(form.getByRole('textbox', { name: 'What the partner gets' })).toHaveValue('PK')
  },
})

export const MissingCodeFromDocument = meta.story({
  args: { code: 'KRT' },
  async play() {
    const form = await addForm()

    await expect(form.getByRole('textbox', { name: 'Your value' })).toHaveValue('KRT')
    await waitFor(() =>
      expect(form.getByRole('textbox', { name: 'What the partner gets' })).toHaveValue('CT'),
    )
  },
})

export const ExistingCodeFromDocument = meta.story({
  args: { code: 'KG' },
  async play({ canvas }) {
    await canvas.findByRole('list', { name: 'Values (5)' })
    // SAFETY: the KG value row is a list item.
    const row = canvas.getByText('KG', { selector: 'span' }).closest('li') as HTMLElement

    await expect(row).toHaveClass('ring-2')
    await expect(canvas.queryByRole('form', { name: 'Add a value' })).toBeNull()
  },
})

export const AddFromMissingCode = meta.story({
  async play({ canvas }) {
    await userEvent.click(await canvas.findByRole('button', { name: 'Add BTL' }))
    const form = await addForm()

    await expect(form.getByRole('textbox', { name: 'Your value' })).toHaveValue('BTL')
    await expect(form.getByRole('textbox', { name: 'What the partner gets' })).toHaveValue('BO')
  },
})

export const ProcessAgainAfterSaving = meta.story({
  args: { add: 'KRT' },
  async play({ canvas }) {
    const form = await addForm()

    await waitFor(() =>
      expect(form.getByRole('textbox', { name: 'What the partner gets' })).toHaveValue('CT'),
    )
    await userEvent.click(form.getByRole('button', { name: 'Save' }))

    const title = await canvas.findByText('KRT is now sent as CT')
    // SAFETY: the title sits inside its alert.
    const fixed = within(title.closest('[data-slot="alert"]') as HTMLElement)

    await expect(title).toBeVisible()
    await expect(fixed.getAllByRole('link')[0]).toHaveAttribute(
      'href',
      expect.stringMatching(/^\/documents\/[\w-]+$/),
    )
    await waitFor(() => expect(canvas.queryByRole('button', { name: 'Add KRT' })).toBeNull())
    await expect(valueRow('KRT').getByText('CT')).toBeVisible()
  },
})

export const EditValue = meta.story({
  async play({ canvas }) {
    await canvas.findByRole('list', { name: 'Values (5)' })
    await userEvent.click(valueRow('KG').getByRole('button', { name: 'Edit KG' }))
    const form = within(canvas.getByRole('form', { name: 'Change KG' }))
    const target = form.getByRole('textbox', { name: 'What the partner gets' })

    await userEvent.clear(target)
    await userEvent.type(target, 'KGS{Enter}')

    await expect(await canvas.findByText('KGS')).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Edit KG' })).toHaveFocus()
  },
})

export const RejectsDuplicateValue = meta.story({
  async play({ canvas }) {
    await userEvent.click(await canvas.findByRole('button', { name: 'Add a value' }))
    const form = await addForm()

    await userEvent.type(form.getByRole('textbox', { name: 'Your value' }), 'KG')
    await userEvent.type(form.getByRole('textbox', { name: 'What the partner gets' }), 'KGS')
    await userEvent.click(form.getByRole('button', { name: 'Save' }))

    await expect(form.getByText('KG already has a translation.')).toBeVisible()
    await expect(form.getByRole('textbox', { name: 'Your value' })).toHaveAttribute(
      'aria-invalid',
      'true',
    )
  },
})

export const UndoAfterRemoving = meta.story({
  async play({ canvas }) {
    await canvas.findByRole('list', { name: 'Values (5)' })
    await userEvent.click(valueRow('ST').getByRole('button', { name: 'Remove ST' }))

    await expect(await canvas.findByText('ST removed. It was sent as PCE.')).toBeVisible()
    await expect(await canvas.findByRole('list', { name: 'Values (4)' })).toBeVisible()

    const undo = canvas.getByRole('button', { name: 'Undo' })

    await expect(undo).toHaveFocus()
    await userEvent.click(undo)

    await expect(await canvas.findByRole('list', { name: 'Values (5)' })).toBeVisible()
    await expect(canvas.queryByText('ST removed. It was sent as PCE.')).toBeNull()
    await expect(canvas.getByRole('button', { name: 'Edit ST' })).toHaveFocus()
  },
})

export const ImportCsv = meta.story({
  parameters: { a11y: { context: 'body' } },
  async play({ canvas }) {
    await userEvent.click(await canvas.findByRole('button', { name: 'Import CSV' }))

    await expect(await screen.findByRole('dialog', { name: 'Import CSV' })).toBeInTheDocument()
  },
})

export const Viewer = meta.story({
  ...viewerStory({
    async play({ canvas }) {
      await canvas.findByRole('list', { name: 'Values (5)' })
      await expect(await canvas.findByText('KRT')).toBeVisible()
      await expect(canvas.queryByRole('button', { name: 'Add a value' })).toBeNull()
      await expect(canvas.queryByRole('button', { name: 'Add KRT' })).toBeNull()
      await expect(canvas.queryByRole('button', { name: /^(Edit|Remove) / })).toBeNull()
      await expect(canvas.queryByRole('button', { name: 'Import CSV' })).toBeNull()
    },
  }),
})

export const ViewerFromLink = meta.story({
  args: { add: 'KRT' },
  ...viewerStory({
    async play({ canvas }) {
      await canvas.findByRole('list', { name: 'Values (5)' })
      await expect(canvas.queryByRole('form', { name: 'Add a value' })).toBeNull()
    },
  }),
})

export const German = meta.story({
  decorators: [german],
  args: { add: 'KRT' },
  async play({ canvas }) {
    await expect(await canvas.findByRole('list', { name: 'Werte (5)' })).toBeVisible()
    await expect(canvas.getByText('Mengeneinheiten · An jeden Partner gesendet')).toBeVisible()
    await expect(await canvas.findByRole('region', { name: 'Noch nicht übersetzt' })).toBeVisible()

    const form = within(await screen.findByRole('form', { name: 'Wert hinzufügen' }))

    await expect(form.getByRole('textbox', { name: 'Ihr Wert' })).toHaveValue('KRT')
    await waitFor(() =>
      expect(form.getByRole('textbox', { name: 'Was der Partner erhält' })).toHaveValue('CT'),
    )
  },
})

export const GermanEmpty = meta.story({
  decorators: [german],
  args: { id: emptyTable.id },
  async play({ canvas }) {
    await expect(await canvas.findByText('Noch keine Werte')).toBeVisible()
  },
})

export const Dark = meta.story({
  args: { add: 'KRT' },
  beforeEach() {
    return darkMode()
  },
  async play({ canvas }) {
    await expect(await canvas.findByRole('list', { name: 'Values (5)' })).toBeVisible()
    await expect(await canvas.findByRole('region', { name: 'Not translated yet' })).toBeVisible()
  },
})

export const DarkAfterSaving = meta.story({
  args: { add: 'KRT' },
  beforeEach() {
    return darkMode()
  },
  async play({ canvas }) {
    const form = await addForm()

    await waitFor(() =>
      expect(form.getByRole('textbox', { name: 'What the partner gets' })).toHaveValue('CT'),
    )
    await userEvent.click(form.getByRole('button', { name: 'Save' }))
    await expect(await canvas.findByText('KRT is now sent as CT')).toBeVisible()
  },
})

export const Mobile = meta.story({
  ...mobile,
  args: { add: 'KRT' },
  async play({ canvas, canvasElement }) {
    await canvas.findByRole('list', { name: 'Values (5)' })
    await expectNoPageScroll(canvasElement)
  },
})
