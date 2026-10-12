import { delay, http, HttpResponse } from 'msw'
import { expect, fn, screen, userEvent, waitFor, within } from 'storybook/test'

import { darkMode, expectNoPageScroll, german, mobile } from '@/components/story-helpers'
import { PartnerWizard } from '@/components/trading-partners/partner-wizard'
import {
  chooseMapping,
  continueTo,
  findMappingGroup,
  mappingSelect,
  toMappings,
  wizardPartner,
} from '@/components/trading-partners/partner-wizard-story-helpers'
import { apiUrl } from '@/lib/api/config'
import { publishedMappingVersionsEndpoint } from '@edi-bridge/contracts'
import {
  createMappingDrafts,
  createMappingVersions,
  createMappingVersionStore,
  publishedMappingVersionsHandler,
  seedMappings,
} from '@edi-bridge/mocks'

import preview from '../../.storybook/preview'

const onlyOrdersMapping = seedMappings.find(({ messageType }) => messageType === 'ORDERS')

const onlyOrdersMappingName = onlyOrdersMapping?.versions[0]?.mappingName ?? ''

const meta = preview.meta({
  title: 'Trading Partners/PartnerWizard/Mappings',
  component: PartnerWizard,
  args: { onFinish: fn() },
  parameters: { layout: 'fullscreen' },
})

export const Choices = meta.story({
  async play({ canvas }) {
    await toMappings(canvas, ['ORDERS', 'INVOIC'])
    const orders = await findMappingGroup(canvas, 'ORDERS')
    await expect(orders.getAllByRole('radio')).toHaveLength(3)
    await expect(
      orders.getByText('6 published mappings for purchase orders to choose from.'),
    ).toBeVisible()

    await chooseMapping(canvas, 'ORDERS', 'Hansemarkt: ORDERS to ERP JSON')
    await expect(mappingSelect(canvas, 'ORDERS')).toHaveTextContent(
      'Hansemarkt: ORDERS to ERP JSON',
    )

    const invoices = await findMappingGroup(canvas, 'INVOIC')
    await userEvent.click(invoices.getByRole('radio', { name: /Let AI draft one/ }))
    await continueTo(canvas, 'Review and create')
  },
})

export const Later = meta.story({
  async play({ canvas }) {
    await toMappings(canvas, ['DESADV'])
    const dispatch = await findMappingGroup(canvas, 'DESADV')
    await userEvent.click(dispatch.getByRole('radio', { name: /^Later/ }))
    await continueTo(canvas, 'Review and create')
  },
})

export const ValidationErrors = meta.story({
  async play({ canvas }) {
    await toMappings(canvas, ['ORDERS', 'INVOIC'])
    await findMappingGroup(canvas, 'INVOIC')
    await userEvent.click(canvas.getByRole('button', { name: 'Continue' }))

    const orders = canvas.getByRole('radiogroup', { name: 'Mapping for purchase orders' })
    await expect(orders).toHaveAccessibleDescription(
      'Choose a mapping, let the AI draft one, or choose later.',
    )
    await expect(within(orders).getAllByRole('radio')[0]).toHaveFocus()

    await userEvent.click(within(orders).getByRole('radio', { name: /existing mapping/ }))
    const invoices = await findMappingGroup(canvas, 'INVOIC')
    await userEvent.click(invoices.getByRole('radio', { name: /^Later/ }))
    await userEvent.click(canvas.getByRole('button', { name: 'Continue' }))
    await expect(mappingSelect(canvas, 'ORDERS')).toHaveFocus()
    await expect(canvas.getByText('Choose a mapping.')).toBeVisible()
  },
})

export const Suggested = meta.story({
  beforeEach({ msw }) {
    msw.use(publishedMappingVersionsHandler(apiUrl, onlyOrdersMapping ? [onlyOrdersMapping] : []))
  },
  async play({ canvas }) {
    await toMappings(canvas, ['ORDERS'])
    const orders = await findMappingGroup(canvas, 'ORDERS')

    const suggested = orders.getByRole('radio', {
      name: new RegExp(`^Use ${onlyOrdersMappingName}`),
    })

    await expect(orders.getByText('Suggested')).toBeVisible()
    await userEvent.click(suggested)
    await expect(canvas.queryByRole('combobox')).not.toBeInTheDocument()
    await continueTo(canvas, 'Review and create')
  },
})

export const Loading = meta.story({
  beforeEach({ msw }) {
    msw.use(
      http.get(`${apiUrl}${publishedMappingVersionsEndpoint.path}`, async () => {
        await delay('infinite')
      }),
    )
  },
  async play({ canvas }) {
    await toMappings(canvas, ['ORDERS'])
    await expect(canvas.getByRole('status')).toHaveTextContent(
      'Loading the mappings for purchase orders…',
    )
    await expect(canvas.queryByRole('radiogroup')).not.toBeInTheDocument()
  },
})

export const LoadFailed = meta.story({
  beforeEach({ msw }) {
    msw.use(
      http.get(`${apiUrl}${publishedMappingVersionsEndpoint.path}`, () =>
        HttpResponse.json({ message: 'Internal Server Error' }, { status: 500 }),
      ),
    )
  },
  async play({ canvas }) {
    await toMappings(canvas, ['ORDERS'])
    const alert = await canvas.findByRole('alert')
    await expect(alert).toHaveTextContent('The mappings for purchase orders could not be loaded.')
    await expect(within(alert).getByRole('button', { name: 'Try again' })).toBeVisible()

    const orders = await findMappingGroup(canvas, 'ORDERS')
    await expect(orders.getAllByRole('radio')).toHaveLength(2)
    await userEvent.click(orders.getByRole('radio', { name: /Let AI draft one/ }))
    await continueTo(canvas, 'Review and create')
  },
})

export const NoPublishedMapping = meta.story({
  beforeEach({ msw }) {
    msw.use(
      http.get(`${apiUrl}${publishedMappingVersionsEndpoint.path}`, () => HttpResponse.json([])),
    )
  },
  async play({ canvas }) {
    await toMappings(canvas, ['INVOIC'])
    const invoices = await findMappingGroup(canvas, 'INVOIC')
    await expect(invoices.getAllByRole('radio')).toHaveLength(2)
    await expect(
      canvas.getByText(
        'No mapping for invoices is published yet. Let the AI draft one, or choose one later.',
      ),
    ).toBeVisible()
  },
})

export const ManyMappings = meta.story({
  beforeEach({ msw }) {
    msw.use(
      publishedMappingVersionsHandler(
        apiUrl,
        createMappingVersionStore(createMappingVersions(createMappingDrafts({ count: 120 }))),
      ),
    )
  },
  async play({ canvas, canvasElement }) {
    await toMappings(canvas, ['ORDERS'])
    const orders = await findMappingGroup(canvas, 'ORDERS')
    await expect(orders.getAllByRole('radio')).toHaveLength(3)
    await userEvent.click(orders.getByRole('radio', { name: /existing mapping/ }))
    await userEvent.click(mappingSelect(canvas, 'ORDERS'))
    await waitFor(async () =>
      expect((await screen.findAllByRole('option')).length).toBeGreaterThan(20),
    )
    await userEvent.keyboard('{Escape}')
    await expectNoPageScroll(canvasElement)
  },
})

export const German = meta.story({
  decorators: [german],
  async play({ canvas }) {
    await userEvent.type(canvas.getByLabelText('Firmenname'), wizardPartner)
    await userEvent.click(canvas.getByRole('checkbox', { name: 'Ich trage sie später ein' }))
    await userEvent.click(canvas.getByRole('button', { name: 'Weiter' }))
    await userEvent.click(await canvas.findByRole('checkbox', { name: /Rechnungen senden/ }))
    await userEvent.click(canvas.getByRole('button', { name: 'Weiter' }))
    await userEvent.click(await canvas.findByRole('radio', { name: /Wir fragen den Partner/ }))
    await userEvent.click(canvas.getByRole('button', { name: 'Weiter' }))

    const invoices = within(
      await canvas.findByRole('radiogroup', { name: 'Mapping für Rechnungen' }),
    )

    await expect(invoices.getByRole('radio', { name: /Von der KI entwerfen lassen/ })).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Weiter' }))
    await expect(
      canvas.getByText(
        'Wählen Sie ein Mapping, lassen Sie die KI eines entwerfen, oder wählen Sie später.',
      ),
    ).toBeVisible()
  },
})

export const Dark = meta.story({
  beforeEach: darkMode,
  async play({ canvas }) {
    await toMappings(canvas, ['ORDERS', 'DESADV'], { glnLater: true })
    await chooseMapping(canvas, 'ORDERS', 'Elbtal: ORDERS to ERP JSON')
    await userEvent.click(canvas.getByRole('button', { name: 'Continue' }))
    await expect(
      canvas.getByText('Choose a mapping, let the AI draft one, or choose later.'),
    ).toBeVisible()
  },
})

export const Mobile = meta.story({
  ...mobile,
  async play({ canvas, canvasElement }) {
    await toMappings(canvas, ['ORDERS', 'INVOIC'], { glnLater: true })
    await chooseMapping(canvas, 'ORDERS', 'Elbtal: ORDERS to ERP JSON')
    await expect(mappingSelect(canvas, 'ORDERS')).toBeVisible()
    await expectNoPageScroll(canvasElement)
  },
})
