import { delay, http, HttpResponse } from 'msw'
import { NextIntlClientProvider } from 'next-intl'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { MappingCanvasScreen } from '@/components/mappings/mapping-canvas-screen'
import {
  detailsPanel,
  dragLink,
  findRow,
  liveStatus,
  pressOn,
  seeded,
  source,
  target,
  transformNodeOf,
} from '@/components/mappings/mapping-canvas-story-helpers'
import { apiUrl } from '@/lib/api/config'
import messagesDe from '@/messages/de.json'
import { mappingDraftEndpoint, saveMappingDraftEndpoint, toPath } from '@edi-bridge/contracts'
import { createHandlers } from '@edi-bridge/mocks'

import preview from '../../.storybook/preview'

const invoic = seeded('Hansemarkt: ERP JSON to INVOIC')

const desadv = seeded('Hansemarkt: ERP JSON to DESADV')

const withoutLinks = seeded('Rheinkauf: ERP JSON to INVOIC')

const meta = preview.meta({
  title: 'Mappings/MappingCanvasScreen/Transforms',
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

function node(canvasElement: HTMLElement, name: string) {
  return within(transformNodeOf(canvasElement, name))
}

async function findNode(canvasElement: HTMLElement, name: string) {
  await within(canvasElement).findByRole('group', { name: `Transform ${name}` })

  return node(canvasElement, name)
}

function edgeNamed(canvasElement: HTMLElement, name: string) {
  return within(canvasElement)
    .getByRole('img', { name })
    .querySelector<SVGElement>('.react-flow__edge-interaction')!
}

async function place(canvasElement: HTMLElement, kind: string, name: string) {
  const canvas = within(canvasElement)

  await userEvent.click(await canvas.findByRole('button', { name: `Add ${kind}` }))

  const header = await canvas.findByRole('button', { name })

  await waitFor(() => expect(header).toHaveFocus())

  return header
}

export const TransformNodes = meta.story({
  args: { id: invoic.id },
  async play({ canvas, canvasElement }) {
    await expect(await canvas.findByText('9 Transforms')).toBeVisible()

    const dateFormat = await findNode(canvasElement, 'Date format 1')

    await expect(dateFormat.getByText('yyyy-MM-dd → yyyyMMdd')).toBeVisible()
    await expect(
      dateFormat.getByRole('button', { name: 'Value input of Date format 1' }),
    ).toHaveAccessibleDescription('Linked from invoiceDate.')
    await expect(
      dateFormat.getByRole('button', { name: 'Result output of Date format 1' }),
    ).toHaveAccessibleDescription('Linked to DTM+137/C507/2380.')
    await expect(
      await canvas.findByRole('img', { name: 'Link from invoiceDate to Date format 1 (Value)' }),
    ).toBeInTheDocument()
    await expect(
      canvas.getByRole('img', { name: 'Link from Date format 1 (Result) to DTM+137/C507/2380' }),
    ).toBeInTheDocument()
    await expect(
      canvas.getByRole('img', { name: 'Link from Constant 1 (Result) to Conditional 1 (Then)' }),
    ).toBeInTheDocument()

    // A target a transform fills counts as linked, so a pending link does not offer it.
    const filled = await findRow(canvasElement, target('DTM+137/C507/2380'))

    await pressOn(await findRow(canvasElement, source('invoiceNumber')), 'l')
    await expect(filled.closest('[data-link-target]')).toBeNull()
    await pressOn(filled, 'l')
    await waitFor(() =>
      expect(canvas.getByRole('alert')).toHaveTextContent(
        'DTM+137/C507/2380 is already linked from Date format 1 (Result). Remove that link first.',
      ),
    )

    // The target lists the link that fills it, also by the transform's name.
    await userEvent.keyboard('{Escape}')
    await pressOn(filled, '{Enter}')
    await expect(
      detailsPanel(canvasElement).getByText('Date format 1 (Result) to DTM+137/C507/2380'),
    ).toBeVisible()
  },
})

export const InvalidNodes = meta.story({
  args: { id: invoic.id },
  async play({ canvasElement }) {
    const numberFormat = await findNode(canvasElement, 'Number format 1')
    const header = numberFormat.getByRole('button', { name: 'Number format 1' })

    await expect(
      transformNodeOf(canvasElement, 'Number format 1').firstElementChild,
    ).toHaveAttribute('data-invalid', 'true')
    await expect(numberFormat.getByText('1 problem')).toBeVisible()
    await expect(numberFormat.getByText('Decimal places must be between 0 and 6.')).toBeVisible()
    await expect(header).toHaveAccessibleDescription(/Decimal places must be between 0 and 6\./)

    const split = node(canvasElement, 'Split 1')

    await expect(split.getByText('Separator is required.')).toBeVisible()

    const dateFormat = node(canvasElement, 'Date format 1')

    await expect(dateFormat.queryByText(/problem/)).toBeNull()
  },
})

export const PanToWholeNode = meta.story({
  args: { id: invoic.id },
  async play({ canvasElement }) {
    const name = 'Loop over line items 1'
    const loop = await findNode(canvasElement, name)

    loop.getByRole('button', { name }).focus()

    // The whole node comes into view, not only its focused button.
    await waitFor(() => {
      const pane = canvasElement.querySelector('.react-flow')!.getBoundingClientRect()
      const shown = transformNodeOf(canvasElement, name).getBoundingClientRect()

      return expect({
        top: shown.top >= pane.top,
        bottom: shown.bottom <= pane.bottom,
      }).toEqual({ top: true, bottom: true })
    })
  },
})

export const PlaceTransform = meta.story({
  args: { id: withoutLinks.id },
  async play({ canvas, canvasElement }) {
    await expect(await canvas.findByText('No Transforms yet')).toBeVisible()

    const header = await place(canvasElement, 'Date format', 'Date format 1')

    await expect(header).toHaveAttribute('aria-pressed', 'true')

    const dateFormat = node(canvasElement, 'Date format 1')

    await expect(dateFormat.getByText('The Value input is not linked.')).toBeVisible()
    await expect(
      dateFormat.getByRole('button', { name: 'Value input of Date format 1' }),
    ).toHaveAccessibleDescription('Not linked yet.')

    const panel = detailsPanel(canvasElement)

    await expect(panel.getByRole('heading', { name: 'Date format 1' })).toBeVisible()
    await expect(panel.getByRole('textbox', { name: 'From pattern' })).toHaveValue('yyyy-MM-dd')
    await expect(panel.getByRole('textbox', { name: 'To pattern' })).toHaveValue('yyyyMMdd')
    await expect(await canvas.findByText('Saved')).toBeVisible()
    await expect(canvas.getByText('1 Transform')).toBeVisible()
    await waitFor(() => expect(liveStatus(canvasElement)).toHaveTextContent('Date format 1 added.'))

    // A second one goes beside or below the first, not on top of it.
    await place(canvasElement, 'Constant', 'Constant 1')

    const first = transformNodeOf(canvasElement, 'Date format 1').getBoundingClientRect()
    const second = transformNodeOf(canvasElement, 'Constant 1').getBoundingClientRect()

    await expect(
      first.right <= second.left || second.bottom <= first.top || first.bottom <= second.top,
    ).toBe(true)
    await expect(await canvas.findByText('2 Transforms')).toBeVisible()
  },
})

export const ConnectByKeyboard = meta.story({
  args: { id: withoutLinks.id },
  async play({ canvas, canvasElement }) {
    await place(canvasElement, 'Date format', 'Date format 1')

    const dateFormat = node(canvasElement, 'Date format 1')
    const input = dateFormat.getByRole('button', { name: 'Value input of Date format 1' })
    const output = dateFormat.getByRole('button', { name: 'Result output of Date format 1' })

    // From a source field into the transform's input.
    await pressOn(await findRow(canvasElement, source('invoiceDate')), 'l')
    await waitFor(() => expect(input.closest('[data-link-target]')).not.toBeNull())
    await expect(input).toHaveAccessibleDescription(
      'Not linked yet. Can take the link from invoiceDate',
    )
    await pressOn(input, '{Enter}')
    await expect(
      await canvas.findByRole('img', { name: 'Link from invoiceDate to Date format 1 (Value)' }),
    ).toBeInTheDocument()

    // From the transform's output into a target element, with the L shortcut.
    await pressOn(output, 'l')
    await expect(output).toHaveAttribute('aria-pressed', 'true')
    await expect(
      detailsPanel(canvasElement).getByText('Linking from Date format 1 (Result).', {
        exact: false,
      }),
    ).toBeVisible()

    const to = await findRow(canvasElement, target('DTM+137/C507/2380'))

    await expect(to.closest('[data-link-target]')).not.toBeNull()
    await pressOn(to, 'l')
    await expect(
      await canvas.findByRole('img', {
        name: 'Link from Date format 1 (Result) to DTM+137/C507/2380',
      }),
    ).toBeInTheDocument()
    await waitFor(() =>
      expect(transformNodeOf(canvasElement, 'Date format 1').firstElementChild).not.toHaveAttribute(
        'data-invalid',
      ),
    )
    await expect(await canvas.findByText('Saved')).toBeVisible()

    // An input takes one link.
    await pressOn(await findRow(canvasElement, source('invoiceNumber')), 'l')
    await expect(input.closest('[data-link-target]')).toBeNull()
    await pressOn(input, 'l')
    await waitFor(() =>
      expect(canvas.getByRole('alert')).toHaveTextContent(
        'Date format 1 (Value) is already linked from invoiceDate. Remove that link first.',
      ),
    )

    // An input without a pending link says how to start one.
    await userEvent.keyboard('{Escape}')
    await pressOn(input, 'l')
    await waitFor(() =>
      expect(liveStatus(canvasElement)).toHaveTextContent(
        'Start a link on a source field or element, or on a Transform output, first.',
      ),
    )
  },
})

export const ConnectByMouse = meta.story({
  args: { id: withoutLinks.id },
  async play({ canvas, canvasElement }) {
    await place(canvasElement, 'Concatenate', 'Concatenate 1')

    await dragLink(canvasElement, source('invoiceNumber'), {
      transform: 'Concatenate 1',
      handle: 'in:part1',
    })
    await expect(
      await canvas.findByRole('img', { name: 'Link from invoiceNumber to Concatenate 1 (Part 1)' }),
    ).toBeInTheDocument()

    await dragLink(canvasElement, source('orderNumber'), {
      transform: 'Concatenate 1',
      handle: 'in:part2',
    })
    await dragLink(
      canvasElement,
      { transform: 'Concatenate 1', handle: 'out:value' },
      target('BGM/1004'),
    )

    await expect(
      await canvas.findByRole('img', { name: 'Link from Concatenate 1 (Result) to BGM/1004' }),
    ).toBeInTheDocument()
    await waitFor(() =>
      expect(node(canvasElement, 'Concatenate 1').queryByText(/not linked/)).toBeNull(),
    )
    await expect(await canvas.findByText('Saved')).toBeVisible()
    await expect(canvas.getByText('3 links')).toBeVisible()
  },
})

export const ConfigureTransform = meta.story({
  args: { id: invoic.id },
  async play({ canvas, canvasElement }) {
    const split = await findNode(canvasElement, 'Split 1')

    await userEvent.click(split.getByRole('button', { name: 'Split 1' }))

    const panel = detailsPanel(canvasElement)
    const separator = panel.getByRole('textbox', { name: 'Separator' })

    await expect(separator).toHaveAttribute('aria-invalid', 'true')
    await expect(separator).toHaveAccessibleDescription(
      'The text the value is split at, e.g. a hyphen. Separator is required.',
    )

    await userEvent.type(separator, '-')
    await expect(separator).toHaveAttribute('aria-invalid', 'false')
    await userEvent.tab()

    await waitFor(() =>
      expect(liveStatus(canvasElement)).toHaveTextContent('Settings of Split 1 saved.'),
    )
    await expect(split.getByText('Piece 0 after “-”')).toBeVisible()
    await expect(split.queryByText('Separator is required.')).toBeNull()

    // A number field takes whole numbers only; Enter saves.
    await userEvent.click(canvas.getByRole('button', { name: 'Number format 1' }))

    const places = panel.getByRole('textbox', { name: 'Decimal places' })

    await expect(places).toHaveAccessibleDescription(
      'From 0 to 6; leave empty to keep the decimal places as they come. Decimal places must be between 0 and 6.',
    )
    await userEvent.clear(places)
    await userEvent.type(places, 'x')
    await expect(panel.getByText('Decimal places must be a whole number.')).toBeVisible()
    await userEvent.clear(places)
    await userEvent.type(places, '2{Enter}')
    await waitFor(() =>
      expect(liveStatus(canvasElement)).toHaveTextContent('Settings of Number format 1 saved.'),
    )
    await expect(
      node(canvasElement, 'Number format 1').queryByText('Decimal places must be between 0 and 6.'),
    ).toBeNull()
  },
})

export const EscapeInSettings = meta.story({
  args: { id: invoic.id },
  async play({ canvasElement }) {
    const header = (await findNode(canvasElement, 'Split 1')).getByRole('button', {
      name: 'Split 1',
    })

    await userEvent.click(header)

    const panel = detailsPanel(canvasElement)
    const separator = panel.getByRole('textbox', { name: 'Separator' })

    // The first Escape takes back what was typed and keeps the form and the focus.
    await userEvent.type(separator, '-')
    await userEvent.keyboard('{Escape}')
    await expect(separator).toHaveValue('')
    await expect(separator).toHaveFocus()
    await expect(header).toHaveAttribute('aria-pressed', 'true')

    // The next clears the selection and takes the focus back to the Transform.
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(header).toHaveFocus())
    await expect(header).toHaveAttribute('aria-pressed', 'false')

    // From a link's remove button, the focus goes back to the selected part.
    const filled = target('DTM+137/C507/2380')

    await pressOn(await findRow(canvasElement, filled), '{Enter}')
    panel
      .getByRole('button', {
        name: 'Remove link from Date format 1 (Result) to DTM+137/C507/2380',
      })
      .focus()
    await userEvent.keyboard('{Escape}')
    await waitFor(async () => expect(await findRow(canvasElement, filled)).toHaveFocus())
    await expect(panel.getByText(/Select a part/)).toBeVisible()
  },
})

export const LowerConcatenateParts = meta.story({
  args: { id: desadv.id },
  async play({ canvas, canvasElement }) {
    const concatenate = await findNode(canvasElement, 'Concatenate 1')

    await expect(
      await canvas.findByRole('img', { name: 'Link from shipTo.city to Concatenate 1 (Part 2)' }),
    ).toBeInTheDocument()

    await userEvent.click(concatenate.getByRole('button', { name: 'Concatenate 1' }))

    const parts = detailsPanel(canvasElement).getByRole('textbox', { name: 'Number of parts' })

    await userEvent.clear(parts)
    await userEvent.type(parts, '1')
    await expect(
      detailsPanel(canvasElement).getByText('Number of parts must be between 2 and 10.'),
    ).toBeVisible()
    await userEvent.tab()

    await waitFor(() =>
      expect(liveStatus(canvasElement)).toHaveTextContent(
        'Settings of Concatenate 1 saved. The link into the removed part was removed.',
      ),
    )
    await expect(
      canvas.queryByRole('img', { name: 'Link from shipTo.city to Concatenate 1 (Part 2)' }),
    ).toBeNull()
    await expect(concatenate.queryByRole('button', { name: /Part 2 input/ })).toBeNull()
    await expect(concatenate.getByText('Number of parts must be between 2 and 10.')).toBeVisible()
    await expect(await canvas.findByText('Saved')).toBeVisible()
  },
})

export const RemoveTransforms = meta.story({
  args: { id: desadv.id },
  async play({ canvas, canvasElement }) {
    await expect(await canvas.findByText('7 Transforms')).toBeVisible()
    await expect(
      await canvas.findByRole('img', { name: 'Link from Constant 1 (Result) to BGM/C002/1001' }),
    ).toBeInTheDocument()

    // By mouse: the node's remove button takes its links along, and focus moves to the next one.
    await userEvent.click(canvas.getByRole('button', { name: 'Remove Constant 1' }))
    await waitFor(() =>
      expect(
        canvas.queryByRole('img', { name: 'Link from Constant 1 (Result) to BGM/C002/1001' }),
      ).toBeNull(),
    )
    await waitFor(() => expect(canvas.getByRole('button', { name: 'Substring 1' })).toHaveFocus())
    await expect(await canvas.findByText('6 Transforms')).toBeVisible()

    // By keyboard: Delete on a transform removes it.
    await userEvent.keyboard('{Delete}')
    await waitFor(() => expect(liveStatus(canvasElement)).toHaveTextContent('Substring 1 removed.'))
    await expect(await canvas.findByText('5 Transforms')).toBeVisible()

    // Delete on an input removes the link into it.
    await pressOn(canvas.getByRole('button', { name: 'Part 2 input of Concatenate 1' }), '{Delete}')
    await waitFor(() =>
      expect(
        canvas.queryByRole('img', { name: 'Link from shipTo.city to Concatenate 1 (Part 2)' }),
      ).toBeNull(),
    )

    // A transform link's own remove button, shown on hover.
    await userEvent.hover(
      edgeNamed(canvasElement, 'Link from shipTo.postalCode to Concatenate 1 (Part 1)'),
    )
    await userEvent.click(
      await canvas.findByRole('button', {
        name: 'Remove link from shipTo.postalCode to Concatenate 1 (Part 1)',
      }),
    )
    await waitFor(() =>
      expect(node(canvasElement, 'Concatenate 1').getByText('2 problems')).toBeVisible(),
    )
    await expect(await canvas.findByText('Saved')).toBeVisible()

    // The panel lists a selected transform's links and removes them, or the transform.
    await userEvent.click(canvas.getByRole('button', { name: 'Concatenate 1' }))

    const panel = detailsPanel(canvasElement)

    await userEvent.click(
      panel.getByRole('button', {
        name: 'Remove link from Concatenate 1 (Result) to SG2+DP/NAD+DP/3164',
      }),
    )
    await waitFor(() => expect(panel.getAllByText('Not linked yet')).toHaveLength(3))
    await userEvent.click(panel.getByRole('button', { name: 'Remove Concatenate 1' }))
    await expect(await canvas.findByText('4 Transforms')).toBeVisible()
    await expect(panel.getByText(/Select a part to keep its meaning/)).toBeVisible()
  },
})

// The node's place on the canvas, apart from where the canvas is panned to.
function flowTop(canvasElement: HTMLElement, name: string) {
  return new DOMMatrix(transformNodeOf(canvasElement, name).style.transform).f
}

export const MoveTransform = meta.story({
  args: { id: invoic.id },
  async play({ canvas, canvasElement }) {
    await userEvent.click(await canvas.findByRole('button', { name: 'Date format 1' }))

    const before = flowTop(canvasElement, 'Date format 1')

    await userEvent.click(
      detailsPanel(canvasElement).getByRole('button', { name: 'Move Date format 1 down' }),
    )
    await waitFor(() => expect(flowTop(canvasElement, 'Date format 1')).toBe(before + 40))
    await waitFor(() => expect(liveStatus(canvasElement)).toHaveTextContent('Date format 1 moved.'))
  },
})

export const SaveErrorRollback = meta.story({
  args: { id: withoutLinks.id },
  beforeEach({ msw }) {
    msw.use(
      http.put(`${apiUrl}${saveMappingDraftEndpoint.path}`, async () => {
        await delay(400)

        return HttpResponse.json({ message: 'Unprocessable' }, { status: 422 })
      }),
    )
  },
  async play({ canvas }) {
    await userEvent.click(await canvas.findByRole('button', { name: 'Add Constant' }))

    await expect(await canvas.findByRole('group', { name: 'Transform Constant 1' })).toBeVisible()
    await expect(canvas.getByText('Saving…')).toBeVisible()

    await waitFor(() =>
      expect(canvas.getByRole('alert')).toHaveTextContent(
        'Constant 1 could not be saved and was taken back. Try again.',
      ),
    )
    await expect(canvas.queryByRole('group', { name: 'Transform Constant 1' })).toBeNull()
    await expect(await canvas.findByText('Not saved')).toBeVisible()
    await expect(canvas.getByText('No Transforms yet')).toBeVisible()
  },
})

// The save of Split 1 waits for the failing save of Constant 1, so it neither sends Constant 1 nor
// brings it back.
export const OverlappingSaveRollback = meta.story({
  args: { id: withoutLinks.id },
  beforeEach({ msw }) {
    let failed = false

    msw.use(
      http.put(`${apiUrl}${saveMappingDraftEndpoint.path}`, async () => {
        if (failed) {
          return undefined
        }

        failed = true
        await delay(400)

        return HttpResponse.json({ message: 'Unprocessable' }, { status: 422 })
      }),
    )
  },
  async play({ canvas }) {
    await userEvent.click(await canvas.findByRole('button', { name: 'Add Constant' }))
    await userEvent.click(canvas.getByRole('button', { name: 'Add Split' }))
    await expect(await canvas.findByRole('group', { name: 'Transform Split 1' })).toBeVisible()

    await waitFor(() =>
      expect(canvas.getByRole('alert')).toHaveTextContent(
        'Constant 1 could not be saved and was taken back. Try again.',
      ),
    )
    await expect(await canvas.findByText('Saved')).toBeVisible()

    const response = await fetch(
      `${apiUrl}${toPath(mappingDraftEndpoint.path, { id: withoutLinks.id })}`,
    )

    const saved = mappingDraftEndpoint.response.parse(await response.json())

    await expect(saved.transforms.map(({ kind }) => kind)).toEqual(['split'])
    await expect(canvas.queryByRole('group', { name: 'Transform Constant 1' })).toBeNull()
    await expect(canvas.getByText('1 Transform')).toBeVisible()
  },
})

export const German = meta.story({
  args: { id: invoic.id },
  // Wide enough for the details panel to sit beside the canvas, where its fields have to fit.
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
    await expect(await canvas.findByText('9 Transforms')).toBeVisible()
    await expect(
      await canvas.findByRole('button', { name: 'Datumsformat hinzufügen' }),
    ).toBeVisible()

    const numberFormat = within(
      (await canvas.findByRole('group', { name: 'Transform Zahlenformat 1' })).closest<HTMLElement>(
        '.react-flow__node',
      )!,
    )

    await expect(
      numberFormat.getByText('Nachkommastellen: Der Wert muss zwischen 0 und 6 sein.'),
    ).toBeVisible()
    await expect(
      await canvas.findByRole('img', {
        name: 'Verknüpfung von invoiceDate zu Datumsformat 1 (Wert)',
      }),
    ).toBeInTheDocument()

    await userEvent.click(canvas.getByRole('button', { name: 'Teilen 1' }))

    const panel = detailsPanel(canvasElement)

    await expect(panel.getByRole('heading', { name: 'Teilen 1' })).toBeVisible()
    await expect(panel.getByText('Trennzeichen: Angabe erforderlich.')).toBeVisible()
    await expect(panel.getByRole('button', { name: 'Teilen 1 entfernen' })).toBeVisible()
  },
})

export const Dark = meta.story({
  args: { id: invoic.id },
  beforeEach() {
    document.documentElement.classList.add('dark')

    return () => document.documentElement.classList.remove('dark')
  },
  async play({ canvas, canvasElement }) {
    const numberFormat = await findNode(canvasElement, 'Number format 1')

    // An invalid node with its form open, and the marks of a link pending from a transform.
    await userEvent.click(numberFormat.getByRole('button', { name: 'Number format 1' }))
    await expect(
      detailsPanel(canvasElement).getByRole('textbox', { name: 'Decimal places' }),
    ).toHaveAttribute('aria-invalid', 'true')
    await pressOn(canvas.getByRole('button', { name: 'Result output of Date format 1' }), 'l')
    await expect(
      canvas.getByRole('button', { name: 'Result output of Date format 1' }),
    ).toHaveAttribute('aria-pressed', 'true')
  },
})
