import { delay, http, HttpResponse } from 'msw'
import { NextIntlClientProvider } from 'next-intl'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { MappingCanvasScreen } from '@/components/mappings/mapping-canvas-screen'
import {
  detailsPanel,
  dragLink,
  findRow,
  findSaveStatus,
  liveStatus,
  page,
  pressOn,
  seeded,
  source,
  target,
  transformNodeOf,
} from '@/components/mappings/mapping-canvas-story-helpers'
import { apiUrl } from '@/lib/api/config'
import messagesDe from '@/messages/de.json'
import { lookupTablesEndpoint } from '@edi-bridge/contracts'
import { createHandlers, lookupTablesHandler, seedLookupTables } from '@edi-bridge/mocks'

import preview from '../../.storybook/preview'

const orders = seeded('Hansemarkt: ORDERS to ERP JSON')

const desadv = seeded('Hansemarkt: ERP JSON to DESADV')

const invoic = seeded('Hansemarkt: ERP JSON to INVOIC')

const withoutLinks = seeded('Rheinkauf: ERP JSON to INVOIC')

const lookupTablesUrl = `${apiUrl}${lookupTablesEndpoint.path}`

const meta = preview.meta({
  title: 'Mappings/MappingCanvasScreen/Advanced transforms',
  component: MappingCanvasScreen,
  parameters: {
    layout: 'fullscreen',
    a11y: { config: { rules: [{ id: 'target-size', enabled: true }] } },
  },
  decorators: [
    (Story) => (
      <div className="flex min-h-svh flex-col">
        <Story />
      </div>
    ),
  ],
  beforeEach({ msw }) {
    msw.use(...createHandlers(apiUrl))
  },
})

async function findNode(canvasElement: HTMLElement, name: string) {
  await within(canvasElement).findByRole('group', { name: `Transform ${name}` })

  return within(transformNodeOf(canvasElement, name))
}

async function select(canvasElement: HTMLElement, name: string) {
  const node = await findNode(canvasElement, name)

  await userEvent.click(node.getByRole('button', { name }))

  return detailsPanel(canvasElement)
}

async function place(canvasElement: HTMLElement, kind: string, name: string) {
  const canvas = within(canvasElement)

  await userEvent.click(await canvas.findByRole('button', { name: `Add ${kind}` }))

  const header = await canvas.findByRole('button', { name })

  await waitFor(() => expect(header).toHaveFocus())

  return header
}

async function chooseOption(canvasElement: HTMLElement, combobox: HTMLElement, name: RegExp) {
  await userEvent.click(combobox)
  await userEvent.click(await page(canvasElement).findByRole('option', { name }))
}

// Each placement is a save of the whole graph, and the saves run one after another, so the kinds
// are placed two per story to stay within the test timeout on a slow CI runner.
export const PlaceLookupTableAndConditional = meta.story({
  args: { id: withoutLinks.id },
  async play({ canvas, canvasElement }) {
    const palette = within(await canvas.findByRole('region', { name: 'Add a Transform' }))

    await expect(palette.getAllByRole('button')).toHaveLength(10)

    await place(canvasElement, 'Lookup Table', 'Lookup Table 1')

    const panel = detailsPanel(canvasElement)

    await expect(await panel.findByRole('combobox', { name: 'Lookup Table' })).toBeVisible()
    await expect(panel.getByRole('radio', { name: 'Keep the incoming value' })).toBeChecked()
    await expect(
      (await findNode(canvasElement, 'Lookup Table 1')).getByText('Lookup Table is required.'),
    ).toBeVisible()

    await place(canvasElement, 'Conditional', 'Conditional 1')
    await expect(panel.getByRole('radio', { name: 'Equals' })).toBeChecked()
    await expect(panel.getByRole('textbox', { name: 'Compare with' })).toBeVisible()
    await expect(await findSaveStatus(canvasElement, 'Saved')).toBeVisible()
    await expect(await canvas.findByText('2 Transforms')).toBeVisible()
  },
})

export const PlaceLoopAndJsonata = meta.story({
  args: { id: withoutLinks.id },
  async play({ canvas, canvasElement }) {
    await place(canvasElement, 'Loop over line items', 'Loop over line items 1')

    const panel = detailsPanel(canvasElement)

    await expect(panel.getByRole('textbox', { name: 'Counter start' })).toHaveValue('1')

    await place(canvasElement, 'JSONata expression', 'JSONata expression 1')
    await expect(panel.getByRole('textbox', { name: 'Expression' })).toHaveValue('')
    await expect(
      (await findNode(canvasElement, 'JSONata expression 1')).getByText('No inputs'),
    ).toBeVisible()
    await expect(await findSaveStatus(canvasElement, 'Saved')).toBeVisible()
    await expect(await canvas.findByText('2 Transforms')).toBeVisible()
  },
})

export const ConfigureLookupTable = meta.story({
  args: { id: invoic.id },
  async play({ canvasElement }) {
    const node = await findNode(canvasElement, 'Lookup Table 1')

    await expect(await node.findByText('VAT categories')).toBeVisible()

    const panel = await select(canvasElement, 'Lookup Table 1')
    const table = await panel.findByRole('combobox', { name: 'Lookup Table' })

    await waitFor(() => expect(table).toHaveTextContent('VAT categories'))
    await expect(panel.getByText('Belongs to: Workspace')).toBeVisible()

    await chooseOption(canvasElement, table, /^Hansemarkt units/)
    await waitFor(() =>
      expect(liveStatus(canvasElement)).toHaveTextContent('Settings of Lookup Table 1 saved.'),
    )
    await expect(panel.getByText(/^Belongs to: Trading Partner Hansemarkt/)).toBeVisible()
    await expect(node.getByText('Hansemarkt units')).toBeVisible()

    await userEvent.click(panel.getByRole('radio', { name: 'Leave the target empty' }))
    await expect(panel.getByRole('radio', { name: 'Leave the target empty' })).toBeChecked()
    await expect(await findSaveStatus(canvasElement, 'Saved')).toBeVisible()
  },
})

export const LookupTableNotChosen = meta.story({
  args: { id: desadv.id },
  async play({ canvasElement }) {
    const node = await findNode(canvasElement, 'Lookup Table 1')

    await expect(node.getByText('Lookup Table is required.')).toBeVisible()
    await expect(node.getByText('No Lookup Table chosen')).toBeVisible()

    const panel = await select(canvasElement, 'Lookup Table 1')
    const table = await panel.findByRole('combobox', { name: 'Lookup Table' })

    await expect(table).toHaveAttribute('aria-invalid', 'true')
    await expect(table).toHaveAccessibleDescription(/Lookup Table is required\./)
  },
})

// VAT categories was deleted after the Mapping chose it.
export const LookupTableDeleted = meta.story({
  args: { id: invoic.id },
  beforeEach({ msw }) {
    msw.use(
      lookupTablesHandler(
        apiUrl,
        seedLookupTables.filter(({ name }) => name !== 'VAT categories'),
      ),
    )
  },
  async play({ canvasElement }) {
    const node = await findNode(canvasElement, 'Lookup Table 1')

    await expect(
      await node.findByText('The chosen Lookup Table no longer exists. Choose another one.'),
    ).toBeVisible()
    await expect(node.getByText('Lookup Table not found')).toBeVisible()

    const panel = await select(canvasElement, 'Lookup Table 1')
    const table = await panel.findByRole('combobox', { name: 'Lookup Table' })

    await expect(table).toHaveAttribute('aria-invalid', 'true')
    await chooseOption(canvasElement, table, /^Country codes/)
    await waitFor(() =>
      expect(
        node.queryByText('The chosen Lookup Table no longer exists. Choose another one.'),
      ).toBeNull(),
    )
    await expect(table).toHaveAttribute('aria-invalid', 'false')
  },
})

export const LookupTablesLoading = meta.story({
  args: { id: invoic.id },
  beforeEach({ msw }) {
    msw.use(
      http.get(lookupTablesUrl, async () => {
        await delay('infinite')

        return HttpResponse.json([])
      }),
    )
  },
  async play({ canvasElement }) {
    const panel = await select(canvasElement, 'Lookup Table 1')
    const table = await panel.findByRole('combobox', { name: 'Lookup Table' })

    await expect(table).toHaveAttribute('aria-busy', 'true')
    await expect(panel.getAllByText('Loading the Lookup Tables…')[0]).toBeVisible()
    await expect(
      within(transformNodeOf(canvasElement, 'Lookup Table 1')).getByText('Lookup Table chosen'),
    ).toBeVisible()
  },
})

export const LookupTablesEmpty = meta.story({
  args: { id: desadv.id },
  beforeEach({ msw }) {
    msw.use(lookupTablesHandler(apiUrl, []))
  },
  async play({ canvasElement }) {
    const panel = await select(canvasElement, 'Lookup Table 1')

    await expect(
      await panel.findByText('There are no Lookup Tables in this Workspace yet.'),
    ).toBeVisible()
    await expect(panel.getByRole('combobox', { name: 'Lookup Table' })).toHaveAttribute(
      'data-disabled',
    )
  },
})

let lookupTablesDown = true

// The list stays down until the play brings it back, so the form's retry reaches it.
export const LookupTablesError = meta.story({
  args: { id: invoic.id },
  beforeEach({ msw }) {
    lookupTablesDown = true

    msw.use(
      http.get(lookupTablesUrl, () =>
        lookupTablesDown ? HttpResponse.json({ message: 'Down' }, { status: 500 }) : undefined,
      ),
    )
  },
  async play({ canvasElement }) {
    const panel = await select(canvasElement, 'Lookup Table 1')

    await expect(
      await panel.findByText('The Lookup Tables could not be loaded.', {}, { timeout: 5000 }),
    ).toBeVisible()
    await expect(panel.getByRole('combobox', { name: 'Lookup Table' })).toHaveAttribute(
      'data-disabled',
    )

    lookupTablesDown = false
    await userEvent.click(panel.getByRole('button', { name: 'Try again' }))
    await expect(
      await panel.findByText('Belongs to: Workspace', {}, { timeout: 5000 }),
    ).toBeVisible()
    await expect(panel.queryByText('The Lookup Tables could not be loaded.')).toBeNull()
  },
})

export const ConfigureConditional = meta.story({
  args: { id: invoic.id },
  async play({ canvasElement }) {
    const panel = await select(canvasElement, 'Conditional 1')
    const node = within(transformNodeOf(canvasElement, 'Conditional 1'))

    await expect(panel.getByRole('radio', { name: 'Equals' })).toBeChecked()
    await expect(panel.getByRole('textbox', { name: 'Compare with' })).toHaveValue('true')

    // An operator without an operand hides the value to compare with.
    await userEvent.click(panel.getByRole('radio', { name: 'Is empty' }))
    await waitFor(() =>
      expect(liveStatus(canvasElement)).toHaveTextContent('Settings of Conditional 1 saved.'),
    )
    await expect(panel.queryByRole('textbox', { name: 'Compare with' })).toBeNull()
    await expect(node.getByText('If the value is empty')).toBeVisible()

    await userEvent.click(panel.getByRole('radio', { name: 'Contains' }))

    const compareTo = panel.getByRole('textbox', { name: 'Compare with' })

    await userEvent.clear(compareTo)
    await userEvent.tab()
    await expect(await node.findByText('Compare with is required.')).toBeVisible()
    await expect(compareTo).toHaveAttribute('aria-invalid', 'true')
    await expect(await findSaveStatus(canvasElement, 'Saved')).toBeVisible()
  },
})

export const ExpressionEditor = meta.story({
  args: { id: orders.id },
  async play({ canvasElement }) {
    const node = await findNode(canvasElement, 'JSONata expression 1')

    await expect(node.getByText('Expression is not a valid JSONata expression.')).toBeVisible()

    const panel = await select(canvasElement, 'JSONata expression 1')
    const editor = panel.getByRole<HTMLTextAreaElement>('textbox', { name: 'Expression' })

    await expect(editor).toHaveAttribute('aria-invalid', 'true')
    await expect(editor).toHaveAccessibleDescription(
      /Syntax error at line 1, column 16: Expected "\)" before the end of the expression/,
    )

    // The error can be reached from its message.
    await userEvent.click(panel.getByRole('button', { name: 'Go to the error' }))
    await waitFor(() => expect(editor).toHaveFocus())
    await expect(editor.selectionStart).toBe(16)

    await userEvent.keyboard(')')
    await expect(panel.getByText('The syntax is valid.')).toBeVisible()
    await userEvent.tab()
    await waitFor(() =>
      expect(liveStatus(canvasElement)).toHaveTextContent(
        'Settings of JSONata expression 1 saved.',
      ),
    )
    await waitFor(() =>
      expect(node.queryByText('Expression is not a valid JSONata expression.')).toBeNull(),
    )
  },
})

export const InsertSourcePath = meta.story({
  args: { id: desadv.id },
  async play({ canvasElement }) {
    const panel = await select(canvasElement, 'JSONata expression 1')
    const editor = panel.getByRole<HTMLTextAreaElement>('textbox', { name: 'Expression' })

    await expect(editor).toHaveValue('$count(packages.lines)')

    // Put the caret into the brackets, then insert a field there.
    await userEvent.clear(editor)
    await userEvent.type(editor, '$count()')
    editor.setSelectionRange(7, 7)
    const sourcePath = panel.getByRole('combobox', { name: 'Source path' })

    // Repeating parts are listed too, so they can be used as a whole, as in $sum(lines.netPrice).
    await userEvent.click(sourcePath)
    const [packages] = await page(canvasElement).findAllByRole('option', { name: /^packages\[\]/ })

    await expect(packages).toHaveAccessibleName(/^packages\[\]($|[^.])/)
    await userEvent.click(await page(canvasElement).findByRole('option', { name: /^shipTo\.city/ }))
    await userEvent.click(panel.getByRole('button', { name: 'Insert path' }))

    await waitFor(() => expect(editor).toHaveValue('$count(shipTo.city)'))
    await waitFor(() => expect(editor).toHaveFocus())
    await expect(editor.selectionStart).toBe(18)
    await expect(await findSaveStatus(canvasElement, 'Saved')).toBeVisible()
  },
})

export const LoopByKeyboard = meta.story({
  args: { id: withoutLinks.id },
  async play({ canvas, canvasElement }) {
    await place(canvasElement, 'Loop over line items', 'Loop over line items 1')

    const loop = within(transformNodeOf(canvasElement, 'Loop over line items 1'))
    const items = loop.getByRole('button', { name: 'Items input of Loop over line items 1' })
    const itemsOut = loop.getByRole('button', { name: 'Items output of Loop over line items 1' })

    // A single field cannot go into the loop's items.
    await pressOn(await findRow(canvasElement, source('invoiceNumber')), 'l')
    await expect(items.closest('[data-link-target]')).toBeNull()
    await pressOn(items, 'l')
    await waitFor(() =>
      expect(liveStatus(canvasElement)).toHaveTextContent(
        'Loop over line items 1 (Items) takes only a whole repeating part, such as lines[] or SG25, not a single field or element.',
      ),
    )
    await userEvent.keyboard('{Escape}')

    // A repeating part goes into the items, and from there into a repeating target part.
    await pressOn(await findRow(canvasElement, source('lines[]')), 'l')
    await waitFor(() => expect(items.closest('[data-link-target]')).not.toBeNull())
    await pressOn(items, 'l')
    await expect(
      await canvas.findByRole('img', {
        name: 'Link from lines[] to Loop over line items 1 (Items)',
      }),
    ).toBeInTheDocument()

    await pressOn(itemsOut, 'l')

    const sg25 = await findRow(canvasElement, target('SG25'))

    await waitFor(() => expect(sg25.closest('[data-link-target]')).not.toBeNull())
    await expect(
      (await findRow(canvasElement, target('BGM/1004'))).closest('[data-link-target]'),
    ).toBeNull()
    await pressOn(sg25, 'l')
    await expect(
      await canvas.findByRole('img', { name: 'Link from Loop over line items 1 (Items) to SG25' }),
    ).toBeInTheDocument()
    await waitFor(() =>
      expect(
        transformNodeOf(canvasElement, 'Loop over line items 1').firstElementChild,
      ).not.toHaveAttribute('data-invalid'),
    )

    // A repeating part links nowhere else.
    await pressOn(await findRow(canvasElement, source('lines[]')), 'l')
    await pressOn(await findRow(canvasElement, target('BGM/1004')), 'l')
    await waitFor(() =>
      expect(liveStatus(canvasElement)).toHaveTextContent(
        'lines is a repeating part. Link it into or out of the Items of a loop over line items, or link the fields beneath it.',
      ),
    )
    await expect(await findSaveStatus(canvasElement, 'Saved')).toBeVisible()
  },
})

export const LoopByMouse = meta.story({
  args: { id: withoutLinks.id },
  async play({ canvas, canvasElement }) {
    await place(canvasElement, 'Loop over line items', 'Loop over line items 1')

    await dragLink(canvasElement, source('lines[]'), {
      transform: 'Loop over line items 1',
      handle: 'in:items',
    })
    await expect(
      await canvas.findByRole('img', {
        name: 'Link from lines[] to Loop over line items 1 (Items)',
      }),
    ).toBeInTheDocument()

    await dragLink(
      canvasElement,
      { transform: 'Loop over line items 1', handle: 'out:items' },
      target('SG25'),
    )
    await expect(
      await canvas.findByRole('img', { name: 'Link from Loop over line items 1 (Items) to SG25' }),
    ).toBeInTheDocument()

    // Fields beneath the parts then link per item.
    await dragLink(canvasElement, source('lines[].quantity'), target('SG25/QTY+47/C186/6060'))
    await expect(
      await canvas.findByRole('img', {
        name: 'Link from lines[].quantity to SG25/QTY+47/C186/6060',
      }),
    ).toBeInTheDocument()
    await expect(await findSaveStatus(canvasElement, 'Saved')).toBeVisible()
  },
})

// A header field linked into a field of the line items runs once for the whole Document, not
// once per item.
export const LinkOutsideLoop = meta.story({
  args: { id: invoic.id },
  async play({ canvasElement }) {
    const loop = await findNode(canvasElement, 'Loop over line items 1')

    const problem =
      'The link from invoiceNumber to SG25/QTY+47/C186/6411 leaves the loop: links run once per item only between fields beneath the looped parts.'

    await expect(loop.queryByText(problem)).toBeNull()

    await pressOn(await findRow(canvasElement, source('invoiceNumber')), 'l')
    await pressOn(await findRow(canvasElement, target('SG25/QTY+47/C186/6411')), 'l')

    await expect(await loop.findByText(problem)).toBeVisible()
    await expect(await findSaveStatus(canvasElement, 'Saved')).toBeVisible()

    const panel = await select(canvasElement, 'Loop over line items 1')

    await expect(panel.getByText(problem)).toBeVisible()
  },
})

// Same-kind Transforms are told apart by their number, so a long name wraps rather than losing it.
export const LongNames = meta.story({
  args: { id: withoutLinks.id },
  async play({ canvasElement }) {
    await place(canvasElement, 'Loop over line items', 'Loop over line items 1')
    await place(canvasElement, 'Loop over line items', 'Loop over line items 2')
    await place(canvasElement, 'JSONata expression', 'JSONata expression 1')

    for (const name of ['Loop over line items 2', 'JSONata expression 1']) {
      const header = (await findNode(canvasElement, name)).getByRole('button', { name })
      const text = header.lastElementChild!

      await expect(text).toHaveTextContent(name)
      await expect(text.scrollWidth).toBeLessThanOrEqual(text.clientWidth)
    }
  },
})

export const German = meta.story({
  args: { id: orders.id },
  parameters: {
    viewport: {
      options: { wide: { name: 'Wide desktop', styles: { width: '1600px', height: '900px' } } },
    },
  },
  globals: { viewport: { value: 'wide', isRotated: false } },
  decorators: [
    (Story) => (
      <NextIntlClientProvider locale="de" messages={messagesDe} timeZone="Europe/Berlin">
        <Story />
      </NextIntlClientProvider>
    ),
  ],
  async play({ canvas, canvasElement }) {
    await expect(
      await canvas.findByRole('button', { name: 'Lookup Table hinzufügen' }),
    ).toBeVisible()

    const name = 'JSONata-Ausdruck 1'

    await userEvent.click(await canvas.findByRole('button', { name }))

    const panel = detailsPanel(canvasElement)

    await expect(panel.getByRole('textbox', { name: 'Ausdruck' })).toHaveAttribute(
      'aria-invalid',
      'true',
    )
    await expect(
      panel.getByText('Syntaxfehler in Zeile 1, Spalte 16: „)“ fehlt vor dem Ende des Ausdrucks.'),
    ).toBeVisible()
    await expect(panel.getByRole('button', { name: 'Pfad einfügen' })).toBeDisabled()

    const header = canvas.getByRole('button', { name: 'Schleife über Positionen 1' })

    await expect(header.lastElementChild).toHaveTextContent('Schleife über Positionen 1')
    await expect(header.lastElementChild!.scrollWidth).toBeLessThanOrEqual(
      header.lastElementChild!.clientWidth,
    )

    await userEvent.click(canvas.getByRole('button', { name: 'Lookup Table 1' }))
    await expect(await panel.findByText('Gehört zu: Workspace')).toBeVisible()
    await expect(panel.getByRole('radio', { name: 'Eingehenden Wert behalten' })).toBeChecked()
  },
})

export const Dark = meta.story({
  args: { id: orders.id },
  beforeEach() {
    document.documentElement.classList.add('dark')

    return () => document.documentElement.classList.remove('dark')
  },
  async play({ canvasElement }) {
    const panel = await select(canvasElement, 'JSONata expression 1')

    await expect(panel.getByRole('textbox', { name: 'Expression' })).toHaveAttribute(
      'aria-invalid',
      'true',
    )

    // The marks of a link pending from a repeating part.
    await pressOn(await findRow(canvasElement, source('SG25')), 'l')
    await waitFor(() =>
      expect(
        within(transformNodeOf(canvasElement, 'Loop over line items 1'))
          .getByRole('button', { name: 'Items input of Loop over line items 1' })
          .closest('[data-link-target]'),
      ).toBeNull(),
    )
  },
})
