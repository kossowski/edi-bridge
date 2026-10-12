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
  seedTradingPartners,
} from '@edi-bridge/mocks'

import type { FailedRunReference, LookupTableKind } from '@edi-bridge/contracts'

import preview from '../../.storybook/preview'

const unitsOfMeasure = seedLookupTableNamed('Units of measure')

const vatCategories = seedLookupTableNamed('VAT categories')

const storeNumbers = seedLookupTableNamed('Hansemarkt store numbers')

function emptyTable(kind: LookupTableKind, index: number) {
  return {
    ...unitsOfMeasure,
    id: `00000000-0000-4000-8000-0000000000e${index}`,
    name: `Empty ${kind}`,
    kind,
    entries: [],
    upcomingCodes: [],
  }
}

const emptyUnits = emptyTable('units', 0)

const emptyCountries = emptyTable('countries', 1)

const emptyAddresses = emptyTable('addresses', 2)

const emptyOther = emptyTable('other', 3)

const [hansemarkt] = seedTradingPartners

function failedRun(index: number, receivedAt: string): FailedRunReference {
  return {
    id: `00000000-0000-4000-8000-0000000001a${index}`,
    receivedAt,
    tradingPartner: { id: hansemarkt!.id, name: hansemarkt!.name },
    messageType: 'ORDERS',
    businessReference: `PO-90000${index}`,
  }
}

const originRun = failedRun(0, '2020-01-01T08:00:00.000Z')

const newestRun = failedRun(1, '2030-01-01T08:00:00.000Z')

const manyRuns = {
  ...unitsOfMeasure,
  blockingCodes: [
    {
      code: 'KRT',
      failedRuns: [
        originRun,
        newestRun,
        failedRun(2, '2021-01-01T08:00:00.000Z'),
        failedRun(3, '2022-01-01T08:00:00.000Z'),
        failedRun(4, '2023-01-01T08:00:00.000Z'),
      ],
    },
  ],
}

const [largeTable] = createLookupTables({
  count: 1,
  entryCount: 400,
  upcomingCodeCount: 200,
  blockingCodeCount: 120,
  seed: 11,
})

const lookupTables = [...seedLookupTables, emptyUnits, emptyCountries, emptyAddresses, emptyOther]

const meta = preview.meta({
  title: 'Code Translations/LookupTableScreen',
  component: LookupTableScreen,
  parameters: { layout: 'fullscreen' },
  args: { id: unitsOfMeasure.id },
  beforeEach({ msw }) {
    msw.use(...lookupTableHandlers(apiUrl, { lookupTables }))
  },
})

function manyRunsHandlers() {
  return lookupTableHandlers(apiUrl, {
    lookupTables: lookupTables.map((table) => (table.id === unitsOfMeasure.id ? manyRuns : table)),
  })
}

function valueRow(code: string) {
  const values = screen.getByRole('list', { name: /^Values/ })

  // SAFETY: every value row starts with its own code and sits in a list item.
  return within(within(values).getByText(code, { selector: 'span' }).closest('li') as HTMLElement)
}

async function missingRow(code: string) {
  const missing = await screen.findByRole('region', { name: 'Not translated yet' })

  // SAFETY: every missing code row names its code and sits in a list item.
  return within(within(missing).getByText(code, { selector: 'span' }).closest('li') as HTMLElement)
}

async function addForm() {
  return within(await screen.findByRole('form', { name: 'Add a value' }))
}

async function fixedAlert(title: string) {
  const heading = await screen.findByText(title)

  // SAFETY: the title sits inside its alert.
  return within(heading.closest('[data-slot="alert"]') as HTMLElement)
}

export const Default = meta.story({
  async play({ canvas }) {
    await expect(
      await canvas.findByRole('heading', { level: 1, name: 'Units of measure' }),
    ).toBeInTheDocument()
    await expect(canvas.getByText('Units of measure · Sent to every partner')).toBeVisible()
    await expect(canvas.getByText('What the partner sends')).toBeVisible()

    const values = within(await canvas.findByRole('list', { name: 'Values (5)' }))

    await expect(values.getAllByRole('listitem')).toHaveLength(5)
    await expect(valueRow('KG').getByText('KGM')).toBeVisible()
    await expect(valueRow('KG').getByText('Kilogram')).toBeVisible()
    await expect(valueRow('KG').getByText('becomes')).toBeInTheDocument()
    await expect(valueRow('KG').getByRole('button', { name: 'Edit KG' })).toBeVisible()

    const krt = await missingRow('KRT')

    await expect(krt.getByText('Carton')).toBeVisible()
    await expect(krt.getByRole('textbox', { name: 'What KRT becomes' })).toHaveValue('CT')
    await expect(krt.getByRole('button', { name: 'Use PK (Package)' })).toBeVisible()
    await expect(krt.getByText(/^Stops Purchase order/)).toBeVisible()
    await expect(krt.getAllByRole('link')[0]).toHaveAttribute(
      'href',
      expect.stringMatching(/^\/documents\/[\w-]+$/),
    )
    await expect(krt.getByRole('button', { name: 'Accept KRT' })).toBeVisible()

    const btl = await missingRow('BTL')

    await expect(btl.getByText('14 items in your ERP data use it')).toBeVisible()
    await expect(btl.getByRole('textbox', { name: 'What BTL becomes' })).toHaveValue('BO')

    const usedFor = within(canvas.getByRole('list', { name: 'Used for' }))

    await expect(usedFor.getAllByRole('link')[0]).toHaveAttribute(
      'href',
      expect.stringMatching(/^\/mappings\/[\w-]+$/),
    )
    await expect(canvas.getByRole('button', { name: 'Import CSV' })).toBeVisible()
  },
})

export const Outgoing = meta.story({
  args: { id: vatCategories.id },
  async play({ canvas }) {
    await canvas.findByRole('list', { name: 'Values (3)' })
    await expect(canvas.getByText('Your value')).toBeVisible()
    await expect(canvas.getByText('What the partner gets')).toBeVisible()
    await expect(valueRow('19').getByText('is sent as')).toBeInTheDocument()
    await expect(valueRow('19').getByText('Standard rate')).toBeVisible()
  },
})

export const Unused = meta.story({
  args: { id: storeNumbers.id },
  async play({ canvas }) {
    await expect(
      await canvas.findByText(
        'No document uses it yet. Add it to a mapping with the “Code translation” step.',
      ),
    ).toBeVisible()
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
  args: { id: emptyUnits.id },
  async play({ canvas }) {
    await expect(await canvas.findByText('No values yet')).toBeVisible()
    await expect(
      canvas.getByText('Add the first value, e.g. the unit ST becomes PCE.'),
    ).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Add a value' })).toBeEnabled()
    await expect(canvas.queryByRole('region', { name: 'Not translated yet' })).toBeNull()
  },
})

export const EmptyCountries = meta.story({
  args: { id: emptyCountries.id },
  async play({ canvas }) {
    await expect(
      await canvas.findByText('Add the first value, e.g. the country Deutschland becomes DE.'),
    ).toBeVisible()
  },
})

export const EmptyAddresses = meta.story({
  args: { id: emptyAddresses.id },
  async play({ canvas }) {
    await expect(
      await canvas.findByText('Add the first value, e.g. a store number becomes an address ID.'),
    ).toBeVisible()
  },
})

export const EmptyOther = meta.story({
  args: { id: emptyOther.id },
  async play({ canvas }) {
    await expect(
      await canvas.findByText('Add the first value: a code and the code it becomes.'),
    ).toBeVisible()
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
    await expect(stopped.getAllByRole('button', { name: /^Accept / })).toHaveLength(120)

    await userEvent.type(canvas.getByRole('searchbox', { name: 'Find a value' }), '17')
    await expect(canvas.getByText(/^\d+ of 400 values$/)).toBeVisible()
  },
})

export const AcceptInPlace = meta.story({
  async play({ canvas }) {
    const krt = await missingRow('KRT')
    const input = krt.getByRole('textbox', { name: 'What KRT becomes' })

    await userEvent.click(krt.getByRole('button', { name: 'Use PK (Package)' }))
    await expect(input).toHaveValue('PK')
    await expect(input).toHaveFocus()
    await expect(krt.getByText('PK means Package.')).toBeVisible()
    await userEvent.click(krt.getByRole('button', { name: 'Accept KRT' }))

    const fixed = await fixedAlert('KRT now becomes PK')

    await expect(fixed.getByRole('link', { name: /^Process .+ again$/ })).toHaveFocus()
    await waitFor(() => expect(canvas.queryByRole('button', { name: 'Accept KRT' })).toBeNull())
    await expect(valueRow('KRT').getByText('PK')).toBeVisible()
  },
})

export const AcceptUpcoming = meta.story({
  async play({ canvas }) {
    const btl = await missingRow('BTL')

    await userEvent.click(btl.getByRole('button', { name: 'Accept BTL' }))

    await waitFor(() => expect(canvas.getByRole('button', { name: 'Edit BTL' })).toHaveFocus())
    await expect(canvas.queryByText(/^BTL now becomes/)).toBeNull()
  },
})

export const RejectsEmptyAccept = meta.story({
  async play() {
    const krt = await missingRow('KRT')
    const input = krt.getByRole('textbox', { name: 'What KRT becomes' })

    await userEvent.clear(input)
    await userEvent.click(krt.getByRole('button', { name: 'Accept KRT' }))

    await expect(krt.getByText('Enter a code.')).toBeVisible()
    await expect(input).toHaveAttribute('aria-invalid', 'true')
  },
})

export const MissingCodeFromLink = meta.story({
  args: { add: 'KRT' },
  async play({ canvas }) {
    const krt = await missingRow('KRT')

    await waitFor(() =>
      expect(krt.getByRole('textbox', { name: 'What KRT becomes' })).toHaveFocus(),
    )
    await expect(krt.getByRole('button', { name: 'Accept KRT' })).toBeVisible()
    await expect(canvas.queryByRole('form', { name: 'Add a value' })).toBeNull()
  },
})

export const NewCodeFromLink = meta.story({
  args: { add: 'DOS' },
  async play() {
    const form = await addForm()

    await expect(form.getByRole('textbox', { name: 'What the partner sends' })).toHaveValue('DOS')
    await expect(form.getByRole('textbox', { name: 'Your value' })).toHaveFocus()
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

export const ReprocessOriginRun = meta.story({
  beforeEach({ msw }) {
    msw.use(...manyRunsHandlers())
  },
  args: { code: 'KRT', run: originRun.id },
  async play({ canvas }) {
    const krt = await missingRow('KRT')

    await waitFor(() =>
      expect(krt.getByRole('textbox', { name: 'What KRT becomes' })).toHaveFocus(),
    )
    await userEvent.click(krt.getByRole('button', { name: 'Accept KRT' }))

    const fixed = await fixedAlert('KRT now becomes CT')
    const reprocess = fixed.getByRole('link', { name: /^Process .+ again$/ })

    await expect(reprocess).toHaveAccessibleName(
      'Process Purchase order PO-900000 from Hansemarkt GmbH again',
    )
    await expect(reprocess).toHaveAttribute('href', `/documents/${originRun.id}`)
    await expect(reprocess).toHaveFocus()

    const more = fixed.getByRole('button', { name: /^and \d+ more$/ })

    await expect(more).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(more)
    await expect(more).toHaveAttribute('aria-expanded', 'true')
    await expect(fixed.getAllByRole('link')).toHaveLength(4)
    await userEvent.click(fixed.getByRole('button', { name: /^Show all \d+$/ }))
    await expect(fixed.getAllByRole('link').length).toBeGreaterThan(4)
    await expect(canvas.queryByRole('button', { name: 'Accept KRT' })).toBeNull()
  },
})

export const ReprocessNewestFirst = meta.story({
  beforeEach({ msw }) {
    msw.use(...manyRunsHandlers())
  },
  async play() {
    const krt = await missingRow('KRT')

    await userEvent.click(krt.getByRole('button', { name: 'Accept KRT' }))

    const fixed = await fixedAlert('KRT now becomes CT')

    await expect(fixed.getByRole('link', { name: /^Process .+ again$/ })).toHaveAttribute(
      'href',
      `/documents/${newestRun.id}`,
    )
  },
})

export const ReprocessAfterEdit = meta.story({
  async play({ canvas }) {
    await canvas.findByRole('list', { name: 'Values (5)' })
    await missingRow('KRT')
    await userEvent.click(valueRow('ST').getByRole('button', { name: 'Edit ST' }))
    const form = within(canvas.getByRole('form', { name: 'Change ST' }))
    const source = form.getByRole('textbox', { name: 'What the partner sends' })

    await userEvent.clear(source)
    await userEvent.type(source, 'KRT{Enter}')

    const fixed = await fixedAlert('KRT now becomes PCE')

    await expect(fixed.getByRole('link', { name: /^Process .+ again$/ })).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Edit KRT' })).toHaveFocus()
  },
})

export const ReprocessAfterImport = meta.story({
  parameters: { a11y: { context: 'body' } },
  async play({ canvas }) {
    await missingRow('KRT')
    await userEvent.click(canvas.getByRole('button', { name: 'Import CSV' }))
    const dialog = within(await screen.findByRole('dialog', { name: 'Import CSV' }))

    await userEvent.click(dialog.getByLabelText('CSV text'))
    await userEvent.paste('KRT;CT')
    await userEvent.click(dialog.getByRole('button', { name: 'Preview import' }))
    await userEvent.click(await dialog.findByRole('button', { name: 'Apply import' }))

    const fixed = await fixedAlert('KRT now becomes CT')

    await expect(fixed.getByRole('link', { name: /^Process .+ again$/ })).toBeVisible()
  },
})

export const LongSeenIn = meta.story({
  beforeEach({ msw }) {
    msw.use(...manyRunsHandlers())
  },
  async play() {
    const krt = await missingRow('KRT')
    const seenIn = within(krt.getByRole('group', { name: 'Seen in' }))

    await expect(seenIn.getAllByRole('link')).toHaveLength(3)
    await expect(seenIn.getAllByRole('link')[0]).toHaveAttribute(
      'href',
      `/documents/${newestRun.id}`,
    )
    await userEvent.click(seenIn.getByRole('button', { name: /^Show all \d+$/ }))
    await expect(seenIn.getAllByRole('link').length).toBeGreaterThanOrEqual(5)
  },
})

export const EditValue = meta.story({
  async play({ canvas }) {
    await canvas.findByRole('list', { name: 'Values (5)' })
    await userEvent.click(valueRow('KG').getByRole('button', { name: 'Edit KG' }))
    const form = within(canvas.getByRole('form', { name: 'Change KG' }))
    const target = form.getByRole('textbox', { name: 'Your value' })

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

    await userEvent.type(form.getByRole('textbox', { name: 'What the partner sends' }), 'KG')
    await userEvent.type(form.getByRole('textbox', { name: 'Your value' }), 'KGS')
    await userEvent.click(form.getByRole('button', { name: 'Save' }))

    await expect(form.getByText('KG already has a translation.')).toBeVisible()
    await expect(form.getByRole('textbox', { name: 'What the partner sends' })).toHaveAttribute(
      'aria-invalid',
      'true',
    )
  },
})

export const UndoAfterRemoving = meta.story({
  async play({ canvas }) {
    await canvas.findByRole('list', { name: 'Values (5)' })
    await userEvent.click(valueRow('ST').getByRole('button', { name: 'Remove ST' }))

    await expect(await canvas.findByText('ST removed. It became PCE.')).toBeVisible()
    await expect(await canvas.findByRole('list', { name: 'Values (4)' })).toBeVisible()

    const undo = canvas.getByRole('button', { name: 'Undo' })

    await expect(undo).toHaveFocus()
    await userEvent.click(undo)

    await expect(await canvas.findByRole('list', { name: 'Values (5)' })).toBeVisible()
    await expect(canvas.queryByText('ST removed. It became PCE.')).toBeNull()
    await expect(canvas.getByRole('button', { name: 'Edit ST' })).toHaveFocus()
  },
})

export const ImportCsv = meta.story({
  parameters: { a11y: { context: 'body' } },
  async play({ canvas }) {
    await userEvent.click(await canvas.findByRole('button', { name: 'Import CSV' }))

    await expect(await screen.findByRole('dialog', { name: 'Import CSV' })).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.getByText(/what the partner sends and your value on each line/)).toBeVisible(),
    )
  },
})

export const Viewer = meta.story({
  ...viewerStory({
    async play({ canvas }) {
      await canvas.findByRole('list', { name: 'Values (5)' })
      await missingRow('KRT')
      await expect(canvas.queryByRole('button', { name: 'Add a value' })).toBeNull()
      await expect(canvas.queryByRole('button', { name: /^Accept / })).toBeNull()
      await expect(canvas.queryByRole('textbox', { name: /becomes$/ })).toBeNull()
      await expect(canvas.queryByRole('button', { name: /^(Edit|Remove) / })).toBeNull()
      await expect(canvas.queryByRole('button', { name: 'Import CSV' })).toBeNull()
    },
  }),
})

export const ViewerFromDocument = meta.story({
  args: { code: 'KRT' },
  ...viewerStory({
    async play({ canvas }) {
      await canvas.findByRole('list', { name: 'Values (5)' })
      const missing = await canvas.findByRole('region', { name: 'Not translated yet' })

      // SAFETY: the KRT missing code row is a list item.
      const row = within(missing)
        .getByText('KRT', { selector: 'span' })
        .closest('li') as HTMLElement

      await expect(row).toHaveClass('ring-2')
      await expect(within(row).getByText(/^Stops Purchase order/)).toBeVisible()
      await expect(canvas.queryByRole('form', { name: 'Add a value' })).toBeNull()
    },
  }),
})

export const German = meta.story({
  decorators: [german],
  args: { code: 'KRT' },
  async play({ canvas }) {
    await expect(await canvas.findByRole('list', { name: 'Werte (5)' })).toBeVisible()
    await expect(canvas.getByText('Mengeneinheiten · An jeden Partner gesendet')).toBeVisible()
    await expect(canvas.getByText('Was der Partner sendet')).toBeVisible()

    const missing = within(await canvas.findByRole('region', { name: 'Noch nicht übersetzt' }))

    await expect(missing.getByRole('textbox', { name: 'Was aus KRT wird' })).toHaveValue('CT')
    await userEvent.click(missing.getByRole('button', { name: 'Übernehmen: KRT' }))
    await expect(await canvas.findByText('KRT wird jetzt zu CT')).toBeVisible()
    await expect(canvas.getByRole('link', { name: /^.+ erneut verarbeiten$/ })).toHaveFocus()
  },
})

export const GermanOutgoing = meta.story({
  decorators: [german],
  args: { id: vatCategories.id },
  async play({ canvas }) {
    await canvas.findByRole('list', { name: 'Werte (3)' })
    await expect(canvas.getByText('Was der Partner erhält')).toBeVisible()
  },
})

export const GermanEmpty = meta.story({
  decorators: [german],
  args: { id: emptyCountries.id },
  async play({ canvas }) {
    await expect(await canvas.findByText('Noch keine Werte')).toBeVisible()
    await expect(
      canvas.getByText('Fügen Sie den ersten Wert hinzu, z. B. wird das Land Deutschland zu DE.'),
    ).toBeVisible()
  },
})

export const Dark = meta.story({
  args: { code: 'KRT' },
  beforeEach() {
    return darkMode()
  },
  async play({ canvas }) {
    await expect(await canvas.findByRole('list', { name: 'Values (5)' })).toBeVisible()
    await expect(await canvas.findByRole('region', { name: 'Not translated yet' })).toBeVisible()
  },
})

export const DarkAfterSaving = meta.story({
  beforeEach({ msw }) {
    msw.use(...manyRunsHandlers())

    return darkMode()
  },
  async play() {
    const krt = await missingRow('KRT')

    await userEvent.click(krt.getByRole('button', { name: 'Accept KRT' }))
    const fixed = await fixedAlert('KRT now becomes CT')

    await userEvent.click(fixed.getByRole('button', { name: /^and \d+ more$/ }))
    await expect(fixed.getByRole('button', { name: /^Show all \d+$/ })).toBeVisible()
  },
})

export const Mobile = meta.story({
  ...mobile,
  beforeEach({ msw }) {
    msw.use(...manyRunsHandlers())
  },
  args: { code: 'KRT' },
  async play({ canvas, canvasElement }) {
    await canvas.findByRole('list', { name: 'Values (5)' })
    await missingRow('KRT')
    await expectNoPageScroll(canvasElement)
  },
})
