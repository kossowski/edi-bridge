import { getRouter } from '@storybook/nextjs-vite/navigation.mock'
import { delay, http, HttpResponse } from 'msw'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { darkMode, german } from '@/components/story-helpers'
import { PartnerScreen } from '@/components/trading-partners/partner-screen'
import {
  asViewer,
  at,
  awaiting,
  live,
  sheetOf,
  untouched,
  withPartnerFrame,
} from '@/components/trading-partners/partner-story-helpers'
import { apiUrl } from '@/lib/api/config'
import {
  channelKinds,
  createFlowEndpoint,
  createMappingEndpoint,
  flowsEndpoint,
  moveFlowMappingVersionEndpoint,
  publishedMappingVersionsEndpoint,
} from '@edi-bridge/contracts'
import {
  createChannel,
  createFlows,
  createHandlers,
  flowHandlers,
  seedChannels,
  seedFlows,
  seedMappings,
  seedTradingPartners,
} from '@edi-bridge/mocks'

import preview from '../../.storybook/preview'

const behindIndex = seedFlows.findIndex(
  (flow, index) => seedMappings[index]!.versions[0]!.id !== flow.mappingVersionId,
)

const behind = seedFlows[behindIndex]!

const newestOfBehind = seedMappings[behindIndex]!.versions[0]!

const behindPartner = seedTradingPartners.find(({ id }) => id === behind.tradingPartnerId)!

const untouchedInbox = {
  ...createChannel(channelKinds[0]),
  name: 'Mainfranken SFTP inbox',
  tradingPartnerId: untouched.id,
}

const withUntouchedInbox = [...seedChannels, untouchedInbox]

function serverError() {
  return HttpResponse.json({ message: 'Internal Server Error' }, { status: 500 })
}

async function documentList(canvasElement: HTMLElement, name: string) {
  return within(await within(canvasElement).findByRole('list', { name }))
}

async function documentItem(canvasElement: HTMLElement, name: string, route: string) {
  const list = await documentList(canvasElement, `Document types with ${name}`)

  return within(list.getByRole('link', { name: route }).closest('li')!)
}

async function openSheet(canvasElement: HTMLElement, name = 'Add a document type') {
  await userEvent.click(await within(canvasElement).findByRole('button', { name }))

  return sheetOf(canvasElement, name)
}

const meta = preview.meta({
  title: 'Trading Partners/PartnerScreen/Documents',
  component: PartnerScreen,
  parameters: { layout: 'fullscreen' },
  decorators: [withPartnerFrame],
  beforeEach({ msw }) {
    msw.use(...createHandlers(apiUrl))
  },
})

export const Documents = meta.story({
  ...at(live, 'documents'),
  async play({ canvas, canvasElement }) {
    await expect(await canvas.findByRole('tab', { name: 'Documents' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await expect(canvas.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'Overview',
      'Documents',
      'Connections',
      'Settings',
    ])

    const list = await documentList(canvasElement, 'Document types with Hansemarkt GmbH')
    const items = list.getAllByRole('listitem')
    await expect(items).toHaveLength(4)

    const orders = within(items[0]!)
    await expect(orders.getByRole('heading', { name: /Purchase orders/ })).toBeVisible()
    await expect(orders.getByText('Hansemarkt GmbH sends these to you')).toBeVisible()
    await expect(orders.getByRole('link', { name: 'Hansemarkt ORDERS inbound' })).toHaveAttribute(
      'href',
      expect.stringMatching(/^\/flows\/[\da-f-]+$/),
    )
    await expect(orders.getByRole('link', { name: 'Hansemarkt SFTP inbox' })).toHaveAttribute(
      'href',
      expect.stringMatching(/^\/channels\/[\da-f-]+$/),
    )
    await expect(
      orders.getByRole('link', { name: 'Hansemarkt: ORDERS to ERP JSON' }),
    ).toHaveAttribute('href', expect.stringMatching(/^\/mappings\/[\da-f-]+$/))

    await expect(within(items[2]!).getByText('You send these to Hansemarkt GmbH')).toBeVisible()
  },
})

export const NewerMappingVersion = meta.story({
  ...at(behindPartner, 'documents'),
  async play({ canvasElement }) {
    const item = await documentItem(canvasElement, behindPartner.name, behind.name)

    await expect(item.getByText(/newer version/)).toBeVisible()
    await expect(
      item.getByRole('button', {
        name: `Move to version ${newestOfBehind.version} for ${behind.name}`,
      }),
    ).toBeVisible()
  },
})

export const MoveToNewerMappingVersion = meta.story({
  ...at(behindPartner, 'documents'),
  async play({ canvas, canvasElement }) {
    const item = await documentItem(canvasElement, behindPartner.name, behind.name)
    await userEvent.click(item.getByRole('button', { name: /^Move to version/ }))

    const dialog = within(await sheetOf(canvasElement, /^Move to version/, 'alertdialog'))
    await waitFor(() => expect(dialog.getByRole('button', { name: 'Cancel' })).toHaveFocus())
    await userEvent.click(
      dialog.getByRole('button', { name: `Move to version ${newestOfBehind.version}` }),
    )

    await expect(
      await canvas.findByText(`${behind.name} now uses version ${newestOfBehind.version}.`),
    ).toBeVisible()

    const moved = await documentItem(canvasElement, behindPartner.name, behind.name)
    await expect(moved.queryByRole('button', { name: /^Move to version/ })).toBeNull()
    await expect(moved.getByText(new RegExp(`, version ${newestOfBehind.version}$`))).toBeVisible()
  },
})

export const MoveFails = meta.story({
  ...at(behindPartner, 'documents'),
  beforeEach({ msw }) {
    msw.use(http.post(`${apiUrl}${moveFlowMappingVersionEndpoint.path}`, serverError))
  },
  async play({ canvasElement }) {
    const item = await documentItem(canvasElement, behindPartner.name, behind.name)
    await userEvent.click(item.getByRole('button', { name: /^Move to version/ }))

    const dialog = within(await sheetOf(canvasElement, /^Move to version/, 'alertdialog'))
    await userEvent.click(dialog.getByRole('button', { name: /^Move to version/ }))
    await expect(
      await dialog.findByText('The document route could not be moved. Try again.'),
    ).toBeVisible()
  },
})

export const DocumentsEmpty = meta.story({
  ...at(untouched, 'documents'),
  async play({ canvas }) {
    await expect(await canvas.findByText('No document types yet')).toBeVisible()
    await expect(
      canvas.getByText(/for example the purchase orders Mainfranken Getränke GmbH sends you/),
    ).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Add a document type' })).toBeVisible()
  },
})

export const DocumentsLoading = meta.story({
  ...at(live, 'documents'),
  beforeEach({ msw }) {
    msw.use(
      http.get(`${apiUrl}${flowsEndpoint.path}`, async () => {
        await delay('infinite')
      }),
    )
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('Loading the document types')).toBeInTheDocument()
  },
})

export const DocumentsUnavailable = meta.story({
  ...at(live, 'documents'),
  beforeEach({ msw }) {
    msw.use(http.get(`${apiUrl}${flowsEndpoint.path}`, serverError))
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('Document types unavailable')).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Try again' })).toBeVisible()
  },
})

export const DocumentsLargeVolume = meta.story({
  ...at(live, 'documents'),
  beforeEach({ msw }) {
    msw.use(
      ...flowHandlers(apiUrl, {
        flows: createFlows({ count: 120 }).map((flow) => ({ ...flow, tradingPartnerId: live.id })),
      }),
    )
  },
  async play({ canvasElement }) {
    const list = await documentList(canvasElement, 'Document types with Hansemarkt GmbH')
    await expect(list.getAllByRole('listitem')).toHaveLength(120)
  },
})

export const DocumentsAsViewer = meta.story({
  ...at(behindPartner, 'documents'),
  ...asViewer(async ({ canvasElement }) => {
    const item = await documentItem(canvasElement, behindPartner.name, behind.name)
    await expect(item.getByText(/newer version/)).toBeVisible()
    await expect(item.queryByRole('button', { name: /^Move to version/ })).toBeNull()
    await expect(
      within(canvasElement).queryByRole('button', { name: 'Add a document type' }),
    ).toBeNull()
  }),
})

export const AddDocumentSheet = meta.story({
  ...at(awaiting, 'documents'),
  async play({ canvasElement }) {
    const sheet = within(await openSheet(canvasElement))
    await expect(sheet.queryByText('Which mapping translates them?')).toBeNull()
    await userEvent.click(sheet.getByRole('radio', { name: /^Invoices/ }))
    await expect(sheet.getByRole('radio', { name: /^Bodensee SFTP outbox/ })).toBeChecked()
    await expect(sheet.getByText('They come from your systems through ERP webhook.')).toBeVisible()
    await expect(await sheet.findByText('Which mapping translates them?')).toBeVisible()
    await expect(sheet.getByRole('radio', { name: /^Create a new one with AI/ })).toBeVisible()
  },
})

export const AddDocumentWithExistingMapping = meta.story({
  ...at(awaiting, 'documents'),
  async play({ canvas, canvasElement }) {
    const sheetElement = await openSheet(canvasElement)
    const sheet = within(sheetElement)
    await userEvent.click(sheet.getByRole('radio', { name: /^Invoices/ }))
    await userEvent.click(await sheet.findByRole('button', { name: 'Add document type' }))

    await waitFor(() => expect(sheetElement).not.toBeInTheDocument())
    await expect(
      await canvas.findByText('Invoices are now set up with Bodensee Handelshaus AG.'),
    ).toBeVisible()

    const list = await documentList(canvasElement, 'Document types with Bodensee Handelshaus AG')
    await waitFor(() => expect(list.getAllByRole('listitem')).toHaveLength(5))
    await expect(
      list.getByRole('link', { name: 'Invoices to Bodensee Handelshaus AG' }),
    ).toBeVisible()
    await waitFor(() =>
      expect(canvas.getByRole('button', { name: 'Add a document type' })).toHaveFocus(),
    )
  },
})

export const AddDocumentWithAi = meta.story({
  ...at(awaiting, 'documents'),
  async play({ canvasElement }) {
    const sheet = within(await openSheet(canvasElement))
    await userEvent.click(sheet.getByRole('radio', { name: /^Dispatch advices/ }))
    await userEvent.click(await sheet.findByRole('radio', { name: /^Create a new one with AI/ }))
    await userEvent.click(sheet.getByRole('button', { name: 'Create the mapping' }))

    await expect(await sheet.findByText(/^The mapping .+ is created\.$/)).toBeVisible()
    await expect(sheet.getByText(/add “Dispatch advices” here again/)).toBeVisible()
    await expect(
      sheet.getByRole('link', { name: 'Open the mapping and draft with AI' }),
    ).toHaveAttribute('href', expect.stringMatching(/^\/mappings\/[\da-f-]+\?ai-draft=start$/))
    await userEvent.click(sheet.getByRole('button', { name: 'Done' }))
  },
})

export const AddDocumentFromSetup = meta.story({
  ...at(untouched),
  beforeEach({ msw }) {
    msw.use(...createHandlers(apiUrl, { channels: withUntouchedInbox }))
  },
  async play({ canvas, canvasElement }) {
    const current = await canvas.findByRole('listitem', { current: 'step' })
    await expect(current).toHaveTextContent('Documents you exchange')
    await userEvent.click(within(current).getByRole('button', { name: 'Add a document type' }))
    await expect(getRouter().replace).toHaveBeenCalledWith(
      `/trading-partners/${untouched.id}?tab=documents`,
      { scroll: false },
    )

    const sheetElement = await sheetOf(canvasElement, 'Add a document type')
    const sheet = within(sheetElement)
    await userEvent.click(sheet.getByRole('radio', { name: /^Purchase orders/ }))
    await expect(sheet.getByRole('radio', { name: /^Mainfranken SFTP inbox/ })).toBeChecked()
    await userEvent.click(await sheet.findByRole('button', { name: 'Add document type' }))

    await waitFor(() => expect(sheetElement).not.toBeInTheDocument())
    await expect(
      await canvas.findByText('Purchase orders are now set up with Mainfranken Getränke GmbH.'),
    ).toBeVisible()
  },
})

export const AddDocumentWithoutConnection = meta.story({
  ...at(untouched, 'documents'),
  async play({ canvasElement }) {
    const sheet = within(await openSheet(canvasElement))
    await userEvent.click(sheet.getByRole('radio', { name: /^Purchase orders/ }))
    await expect(
      sheet.getByText(/No connection receives documents from Mainfranken Getränke GmbH yet/),
    ).toBeVisible()
    await expect(sheet.queryByRole('button', { name: 'Add document type' })).toBeNull()
    await userEvent.click(sheet.getByRole('button', { name: 'Add a connection' }))
    await expect(getRouter().replace).toHaveBeenCalledWith(
      `/trading-partners/${untouched.id}?tab=connections`,
      { scroll: false },
    )
    await sheetOf(canvasElement, 'Add a connection')
  },
})

export const AddDocumentFails = meta.story({
  ...at(awaiting, 'documents'),
  beforeEach({ msw }) {
    msw.use(http.post(`${apiUrl}${createFlowEndpoint.path}`, serverError))
  },
  async play({ canvasElement }) {
    const sheet = within(await openSheet(canvasElement))
    await userEvent.click(sheet.getByRole('radio', { name: /^Invoices/ }))
    await userEvent.click(await sheet.findByRole('button', { name: 'Add document type' }))
    await expect(
      await sheet.findByText('The document type could not be added. Try again.'),
    ).toBeVisible()
  },
})

export const CreateMappingFails = meta.story({
  ...at(awaiting, 'documents'),
  beforeEach({ msw }) {
    msw.use(http.post(`${apiUrl}${createMappingEndpoint.path}`, serverError))
  },
  async play({ canvasElement }) {
    const sheet = within(await openSheet(canvasElement))
    await userEvent.click(sheet.getByRole('radio', { name: /^Invoices/ }))
    await userEvent.click(await sheet.findByRole('radio', { name: /^Create a new one with AI/ }))
    await userEvent.click(sheet.getByRole('button', { name: 'Create the mapping' }))
    await expect(
      await sheet.findByText('The mapping could not be created. Try again.'),
    ).toBeVisible()
  },
})

export const CreateMappingWithoutDataFormat = meta.story({
  ...at(awaiting, 'documents'),
  beforeEach({ msw }) {
    msw.use(
      http.post(`${apiUrl}${createMappingEndpoint.path}`, () =>
        HttpResponse.json(
          { message: 'The Workspace has no Document Structure to map yet.' },
          { status: 422 },
        ),
      ),
      http.get(`${apiUrl}${publishedMappingVersionsEndpoint.path}`, () => HttpResponse.json([])),
    )
  },
  async play({ canvasElement }) {
    const sheet = within(await openSheet(canvasElement))
    await userEvent.click(sheet.getByRole('radio', { name: /^Invoices/ }))
    await expect(
      await sheet.findByRole('radio', { name: /^Create a new one with AI/ }),
    ).toBeChecked()
    await userEvent.click(sheet.getByRole('button', { name: 'Create the mapping' }))
    await expect(await sheet.findByText(/has no data format to translate to yet/)).toBeVisible()
  },
})

export const MappingsUnavailableInSheet = meta.story({
  ...at(awaiting, 'documents'),
  beforeEach({ msw }) {
    msw.use(http.get(`${apiUrl}${publishedMappingVersionsEndpoint.path}`, serverError))
  },
  async play({ canvasElement }) {
    const sheet = within(await openSheet(canvasElement))
    await userEvent.click(sheet.getByRole('radio', { name: /^Invoices/ }))
    await expect(await sheet.findByText(/The mappings could not be loaded/)).toBeVisible()
    await expect(sheet.getByRole('radio', { name: /^Create a new one with AI/ })).toBeChecked()
  },
})

export const GermanDocuments = meta.story({
  ...at(behindPartner, 'documents'),
  decorators: [german],
  async play({ canvas, canvasElement }) {
    await expect(await canvas.findByRole('tab', { name: 'Belege' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await documentList(canvasElement, `Belegarten mit ${behindPartner.name}`)
    await expect(
      canvas.getAllByRole('button', { name: /^Auf Version \d+ umstellen/ })[0],
    ).toBeVisible()
  },
})

export const GermanAddDocumentSheet = meta.story({
  ...at(awaiting, 'documents'),
  decorators: [german],
  async play({ canvasElement }) {
    const sheet = within(await openSheet(canvasElement, 'Belegart hinzufügen'))
    await userEvent.click(sheet.getByRole('radio', { name: /^Rechnungen/ }))
    await expect(await sheet.findByText('Welches Mapping übersetzt sie?')).toBeVisible()
    await expect(sheet.getByRole('radio', { name: /^Ein neues mit KI erstellen/ })).toBeVisible()
  },
})

export const DarkDocuments = meta.story({
  ...at(behindPartner, 'documents'),
  beforeEach: darkMode,
  async play({ canvasElement }) {
    const item = await documentItem(canvasElement, behindPartner.name, behind.name)
    await expect(item.getByText(/newer version/)).toBeVisible()
  },
})

export const DarkAddDocumentSheet = meta.story({
  ...at(awaiting, 'documents'),
  beforeEach: darkMode,
  async play({ canvasElement }) {
    const sheet = within(await openSheet(canvasElement))
    await userEvent.click(sheet.getByRole('radio', { name: /^Invoices/ }))
    await expect(await sheet.findByText('Which mapping translates them?')).toBeVisible()
  },
})
