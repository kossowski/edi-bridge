import { http, HttpResponse } from 'msw'
import { expect, screen, userEvent, waitFor, within } from 'storybook/test'

import { LookupTableScreen } from '@/components/code-translations/lookup-table-screen'
import { viewerStory } from '@/components/session/session-story-helpers'
import { darkMode, expectNoPageScroll, german, mobile } from '@/components/story-helpers'
import { apiUrl } from '@/lib/api/config'
import {
  type AiNoticeReason,
  type FailedRunReference,
  lookupTableMissingCodeHintsEndpoint,
  type LookupTableKind,
} from '@edi-bridge/contracts'
import {
  createLookupTables,
  lookupTableHandlers,
  seedLookupTableNamed,
  seedLookupTables,
  seedTradingPartners,
} from '@edi-bridge/mocks'

import preview from '../../.storybook/preview'

const unitsOfMeasure = seedLookupTableNamed('Units of measure')

const countryCodes = seedLookupTableNamed('Country codes')

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

function failedRun(
  index: number,
  receivedAt: string,
  messageType: 'INVOIC' | 'ORDERS' = 'INVOIC',
): FailedRunReference {
  return {
    id: `00000000-0000-4000-8000-0000000001a${index}`,
    receivedAt,
    tradingPartner: { id: hansemarkt!.id, name: hansemarkt!.name },
    messageType,
    businessReference: `${messageType === 'INVOIC' ? 'INV' : 'PO'}-90000${index}`,
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

const ordersRun = failedRun(5, '2030-01-01T08:00:00.000Z', 'ORDERS')

const stoppedCountries = {
  ...countryCodes,
  blockingCodes: [{ code: 'Polen', failedRuns: [ordersRun] }],
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

function stoppedCountriesHandlers() {
  return lookupTableHandlers(apiUrl, {
    lookupTables: lookupTables.map((table) =>
      table.id === countryCodes.id ? stoppedCountries : table,
    ),
  })
}

function hintsNoticeHandlers(missingCodeHintsNotice: AiNoticeReason) {
  return lookupTableHandlers(apiUrl, { lookupTables, missingCodeHintsNotice })
}

const hintRequests = { count: 0 }

function failingHintsHandler() {
  hintRequests.count = 0

  return http.post(`${apiUrl}${lookupTableMissingCodeHintsEndpoint.path}`, () => {
    hintRequests.count += 1

    return HttpResponse.json({ message: 'The AI hints failed' }, { status: 500 })
  })
}

function valueRow(code: string) {
  const values = screen.getByRole('list', { name: /^Values/ })

  // SAFETY: every value row starts with its own code and sits in a list item.
  return within(within(values).getByText(code, { selector: 'span' }).closest('li') as HTMLElement)
}

async function missingRow(code: string) {
  const missing = await screen.findByRole('region', {
    name: /^(Not translated yet|Noch nicht übersetzt)$/,
  })

  // SAFETY: every missing code row names its code and sits in a list item.
  return within(within(missing).getByText(code, { selector: 'span' }).closest('li') as HTMLElement)
}

// The AI hints of the missing codes arrive after the missing codes, so wait for their first suggestion.
async function hintedRow(code: string, target: string, label = `Send ${code} as`) {
  const row = await missingRow(code)

  await waitFor(() => expect(row.getByRole('textbox', { name: label })).toHaveValue(target))

  return row
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
    await expect(canvas.getByText('Your value')).toBeVisible()
    await expect(canvas.getByText('What the partner gets')).toBeVisible()

    const values = within(await canvas.findByRole('list', { name: 'Values (4)' }))

    await expect(values.getAllByRole('listitem')).toHaveLength(4)
    await expect(valueRow('KG').getByText('KGM')).toBeVisible()
    await expect(valueRow('KG').getByText('Kilogram')).toBeVisible()
    await expect(valueRow('KG').getByText('is sent as')).toBeInTheDocument()
    await expect(valueRow('KG').getByRole('button', { name: 'Edit KG' })).toBeVisible()

    const krt = await hintedRow('KRT', 'CT')

    await expect(krt.getByText('Carton')).toBeVisible()
    await expect(krt.getByRole('button', { name: 'Use PK (Package)' })).toBeVisible()
    await expect(krt.getByText(/^Stops (Invoice|Dispatch advice) .+ to /)).toBeVisible()
    await expect(krt.getAllByRole('link')[0]).toHaveAttribute(
      'href',
      expect.stringMatching(/^\/documents\/[\w-]+$/),
    )
    await expect(krt.getByRole('button', { name: 'Accept KRT' })).toBeVisible()

    const btl = await hintedRow('BTL', 'BO')

    await expect(btl.getByText('14 items in your ERP data use it')).toBeVisible()

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

export const Incoming = meta.story({
  args: { id: countryCodes.id },
  async play({ canvas }) {
    await canvas.findByRole('list', { name: 'Values (3)' })
    await expect(canvas.getByText('What the partner sends')).toBeVisible()
    await expect(canvas.getByText('Your value')).toBeVisible()
    await expect(valueRow('Deutschland').getByText('becomes')).toBeInTheDocument()
    await expect(valueRow('Deutschland').getByText('DE')).toBeVisible()
    await expect(valueRow('Deutschland').getByText('Germany')).toBeVisible()

    const polen = await hintedRow('Polen', 'PL', 'What Polen becomes')

    await expect(polen.getByText('2 items in your ERP data use it')).toBeVisible()
  },
})

export const AcceptIncoming = meta.story({
  args: { id: countryCodes.id },
  beforeEach({ msw }) {
    msw.use(...stoppedCountriesHandlers())
  },
  async play() {
    const polen = await hintedRow('Polen', 'PL', 'What Polen becomes')

    await expect(
      polen.getByText('Stops Purchase order PO-900005 from Hansemarkt GmbH'),
    ).toBeVisible()
    await userEvent.click(polen.getByRole('button', { name: 'Accept Polen' }))

    const fixed = await fixedAlert('Polen now becomes PL')
    const reprocess = fixed.getByRole('link', { name: /^Process .+ again$/ })

    await expect(reprocess).toHaveAccessibleName(
      'Process Purchase order PO-900005 from Hansemarkt GmbH again',
    )
    await expect(reprocess).toHaveAttribute('href', `/documents/${ordersRun.id}`)
    await expect(reprocess).toHaveFocus()
    await expect(valueRow('Polen').getByText('becomes')).toBeInTheDocument()
    await expect(valueRow('Polen').getByText('PL')).toBeVisible()
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
    const krt = await hintedRow('KRT', 'CT')
    const input = krt.getByRole('textbox', { name: 'Send KRT as' })

    await userEvent.click(krt.getByRole('button', { name: 'Use PK (Package)' }))
    await expect(input).toHaveValue('PK')
    await expect(input).toHaveFocus()
    await expect(krt.getByText('PK means Package.')).toBeVisible()
    await userEvent.click(krt.getByRole('button', { name: 'Accept KRT' }))

    const fixed = await fixedAlert('KRT is now sent as PK')

    await expect(fixed.getByRole('link', { name: /^Process .+ again$/ })).toHaveFocus()
    await waitFor(() => expect(canvas.queryByRole('button', { name: 'Accept KRT' })).toBeNull())
    await expect(valueRow('KRT').getByText('PK')).toBeVisible()
  },
})

export const AcceptUpcoming = meta.story({
  async play({ canvas }) {
    const btl = await hintedRow('BTL', 'BO')

    await userEvent.click(btl.getByRole('button', { name: 'Accept BTL' }))

    await waitFor(() => expect(canvas.getByRole('button', { name: 'Edit BTL' })).toHaveFocus())
    await expect(canvas.queryByText(/^BTL is now sent as/)).toBeNull()
  },
})

export const RejectsEmptyAccept = meta.story({
  async play() {
    const krt = await hintedRow('KRT', 'CT')
    const input = krt.getByRole('textbox', { name: 'Send KRT as' })

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

    await waitFor(() => expect(krt.getByRole('textbox', { name: 'Send KRT as' })).toHaveFocus())
    await expect(krt.getByRole('button', { name: 'Accept KRT' })).toBeVisible()
    await expect(canvas.queryByRole('form', { name: 'Add a value' })).toBeNull()
  },
})

export const NewCodeFromLink = meta.story({
  args: { add: 'DOS' },
  async play() {
    const form = await addForm()

    await expect(form.getByRole('textbox', { name: 'Your value' })).toHaveValue('DOS')
    await expect(form.getByRole('textbox', { name: 'What the partner gets' })).toHaveFocus()
  },
})

export const ExistingCodeFromDocument = meta.story({
  args: { code: 'KG' },
  async play({ canvas }) {
    await canvas.findByRole('list', { name: 'Values (4)' })
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
    const krt = await hintedRow('KRT', 'CT')

    await waitFor(() => expect(krt.getByRole('textbox', { name: 'Send KRT as' })).toHaveFocus())
    await userEvent.click(krt.getByRole('button', { name: 'Accept KRT' }))

    const fixed = await fixedAlert('KRT is now sent as CT')
    const reprocess = fixed.getByRole('link', { name: /^Process .+ again$/ })

    await expect(reprocess).toHaveAccessibleName(
      'Process Invoice INV-900000 to Hansemarkt GmbH again',
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
    const krt = await hintedRow('KRT', 'CT')

    await userEvent.click(krt.getByRole('button', { name: 'Accept KRT' }))

    const fixed = await fixedAlert('KRT is now sent as CT')

    await expect(fixed.getByRole('link', { name: /^Process .+ again$/ })).toHaveAttribute(
      'href',
      `/documents/${newestRun.id}`,
    )
  },
})

export const ReprocessAfterEdit = meta.story({
  async play({ canvas }) {
    await canvas.findByRole('list', { name: 'Values (4)' })
    await missingRow('KRT')
    await userEvent.click(valueRow('ST').getByRole('button', { name: 'Edit ST' }))
    const form = within(canvas.getByRole('form', { name: 'Change ST' }))
    const source = form.getByRole('textbox', { name: 'Your value' })

    await userEvent.clear(source)
    await userEvent.type(source, 'KRT{Enter}')

    const fixed = await fixedAlert('KRT is now sent as PCE')

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

    const fixed = await fixedAlert('KRT is now sent as CT')

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
    await canvas.findByRole('list', { name: 'Values (4)' })
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
    await canvas.findByRole('list', { name: 'Values (4)' })
    await userEvent.click(valueRow('ST').getByRole('button', { name: 'Remove ST' }))

    await expect(await canvas.findByText('ST removed. It was sent as PCE.')).toBeVisible()
    await expect(await canvas.findByRole('list', { name: 'Values (3)' })).toBeVisible()

    const undo = canvas.getByRole('button', { name: 'Undo' })

    await expect(undo).toHaveFocus()
    await userEvent.click(undo)

    await expect(await canvas.findByRole('list', { name: 'Values (4)' })).toBeVisible()
    await expect(canvas.queryByText('ST removed. It was sent as PCE.')).toBeNull()
    await expect(canvas.getByRole('button', { name: 'Edit ST' })).toHaveFocus()
  },
})

export const ImportCsv = meta.story({
  parameters: { a11y: { context: 'body' } },
  async play({ canvas }) {
    await userEvent.click(await canvas.findByRole('button', { name: 'Import CSV' }))

    await expect(await screen.findByRole('dialog', { name: 'Import CSV' })).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.getByText(/your value and what the partner gets on each line/)).toBeVisible(),
    )
  },
})

export const Viewer = meta.story({
  ...viewerStory({
    async play({ canvas }) {
      await canvas.findByRole('list', { name: 'Values (4)' })
      await missingRow('KRT')
      await expect(canvas.queryByRole('button', { name: 'Add a value' })).toBeNull()
      await expect(canvas.queryByRole('button', { name: /^Accept / })).toBeNull()
      await expect(canvas.queryByRole('textbox', { name: /^Send .+ as$/ })).toBeNull()
      await expect(canvas.queryByRole('button', { name: /^(Edit|Remove) / })).toBeNull()
      await expect(canvas.queryByRole('button', { name: 'Import CSV' })).toBeNull()
    },
  }),
})

export const ViewerWithoutHints = meta.story({
  ...viewerStory({
    beforeEach({ msw }) {
      msw.use(failingHintsHandler())
    },
    async play() {
      const set = await missingRow('SET')

      await expect(set.getByText('Set')).toBeVisible()
      await expect((await missingRow('KRT')).queryByText('Carton')).toBeNull()
      await expect(hintRequests.count).toBe(0)
    },
  }),
})

export const ViewerFromDocument = meta.story({
  args: { code: 'KRT' },
  ...viewerStory({
    async play({ canvas }) {
      await canvas.findByRole('list', { name: 'Values (4)' })
      const missing = await canvas.findByRole('region', { name: 'Not translated yet' })

      // SAFETY: the KRT missing code row is a list item.
      const row = within(missing)
        .getByText('KRT', { selector: 'span' })
        .closest('li') as HTMLElement

      await expect(row).toHaveClass('ring-2')
      await expect(within(row).getByText(/^Stops (Invoice|Dispatch advice) /)).toBeVisible()
      await expect(canvas.queryByRole('form', { name: 'Add a value' })).toBeNull()
    },
  }),
})

export const German = meta.story({
  decorators: [german],
  args: { code: 'KRT' },
  async play({ canvas }) {
    const values = within(await canvas.findByRole('list', { name: 'Werte (4)' }))

    await expect(values.getAllByText('Stück')).toHaveLength(2)
    await expect(canvas.getByText('Mengeneinheiten · An jeden Partner gesendet')).toBeVisible()
    await expect(canvas.getByText('Was der Partner erhält')).toBeVisible()

    const missing = within(await canvas.findByRole('region', { name: 'Noch nicht übersetzt' }))

    await hintedRow('KRT', 'CT', 'KRT senden als')
    await expect(missing.getByText('CT bedeutet Karton.')).toBeVisible()
    await userEvent.click(missing.getByRole('button', { name: 'Übernehmen: KRT' }))
    await expect(await canvas.findByText('KRT wird jetzt als CT gesendet')).toBeVisible()
    await expect(canvas.getByRole('link', { name: /^.+ erneut verarbeiten$/ })).toHaveFocus()
    await expect(
      await within(canvas.getByRole('list', { name: 'Werte (5)' })).findByText('Karton'),
    ).toBeVisible()
  },
})

export const HintsBudgetUsedUp = meta.story({
  beforeEach({ msw }) {
    msw.use(...hintsNoticeHandlers('aiBudgetExhausted'))
  },
  async play({ canvas }) {
    const notice = await canvas.findByRole('status', { name: 'Values explained without AI' })

    await expect(notice).toHaveTextContent(
      "Today's AI budget is used up, so only known codes are explained and suggested.",
    )
    await expect((await hintedRow('SET', 'SET')).getByText('Set')).toBeVisible()

    const krt = await missingRow('KRT')

    await expect(krt.getByRole('textbox', { name: 'Send KRT as' })).toHaveValue('')
    await expect(krt.queryByText('Carton')).toBeNull()
  },
})

export const HintsUnavailable = meta.story({
  beforeEach({ msw }) {
    msw.use(...hintsNoticeHandlers('aiUnavailable'))
  },
  async play({ canvas }) {
    const notice = await canvas.findByRole('status', { name: 'Values explained without AI' })

    await expect(notice).toHaveTextContent('The AI could not explain the values')
    await expect((await missingRow('KRT')).queryByRole('button', { name: /^Use / })).toBeNull()
  },
})

export const HintsFailed = meta.story({
  beforeEach({ msw }) {
    msw.use(failingHintsHandler())
  },
  async play({ canvas }) {
    await waitFor(() => expect(hintRequests.count).toBe(1))

    const set = await hintedRow('SET', 'SET')

    await expect(set.getByText('Set')).toBeVisible()
    await expect(canvas.queryByRole('status', { name: 'Values explained without AI' })).toBeNull()
    await expect(
      canvas.queryByText('The values that are not translated yet could not be loaded.'),
    ).toBeNull()
  },
})

export const GermanHintsBudgetUsedUp = meta.story({
  decorators: [german],
  beforeEach({ msw }) {
    msw.use(...hintsNoticeHandlers('aiBudgetExhausted'))
  },
  async play({ canvas }) {
    const notice = await canvas.findByRole('status', { name: 'Werte ohne KI erklärt' })

    await expect(notice).toHaveTextContent('Das KI-Budget für heute ist aufgebraucht')
    await expect((await hintedRow('SET', 'SET', 'SET senden als')).getByText('Satz')).toBeVisible()
  },
})

export const GermanIncoming = meta.story({
  decorators: [german],
  args: { id: countryCodes.id },
  async play({ canvas }) {
    const values = within(await canvas.findByRole('list', { name: 'Werte (3)' }))

    await expect(canvas.getByText('Was der Partner sendet')).toBeVisible()
    await expect(values.getAllByText('wird zu')).toHaveLength(3)

    await hintedRow('Polen', 'PL', 'Was aus Polen wird')
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
    await expect(await canvas.findByRole('list', { name: 'Values (4)' })).toBeVisible()
    await expect(await canvas.findByRole('region', { name: 'Not translated yet' })).toBeVisible()
  },
})

export const DarkAfterSaving = meta.story({
  beforeEach({ msw }) {
    msw.use(...manyRunsHandlers())

    return darkMode()
  },
  async play() {
    const krt = await hintedRow('KRT', 'CT')

    await userEvent.click(krt.getByRole('button', { name: 'Accept KRT' }))
    const fixed = await fixedAlert('KRT is now sent as CT')

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
    await canvas.findByRole('list', { name: 'Values (4)' })
    await missingRow('KRT')
    await expectNoPageScroll(canvasElement)
  },
})
