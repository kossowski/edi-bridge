import { getRouter } from '@storybook/nextjs-vite/navigation.mock'
import { delay, http, HttpResponse } from 'msw'
import { NextIntlClientProvider } from 'next-intl'
import { expect, screen, userEvent, waitFor } from 'storybook/test'

import { EditFlowScreen, NewFlowScreen } from '@/components/flows/flow-form-screen'
import { apiUrl } from '@/lib/api/config'
import messagesDe from '@/messages/de.json'
import {
  channelsEndpoint,
  flowEndpoint,
  publishedMappingVersionsEndpoint,
  updateFlowEndpoint,
} from '@edi-bridge/contracts'
import { createHandlers, seedFlows } from '@edi-bridge/mocks'

import preview from '../../.storybook/preview'

const ordersFlow = seedFlows.find((flow) => flow.name === 'Hansemarkt ORDERS inbound')!

function failingUpdate(status: number) {
  return http.put(`${apiUrl}${updateFlowEndpoint.path}`, () =>
    HttpResponse.json({ message: 'Rejected' }, { status }),
  )
}

async function waitForListboxClosed() {
  // The closing listbox stays on the page until its next frame, which a busy runner delays.
  await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull())
}

async function choose(trigger: HTMLElement, option: string | RegExp) {
  await userEvent.click(trigger)
  await userEvent.click(await screen.findByRole('option', { name: option }))
  await waitForListboxClosed()
}

async function expectOptions(trigger: HTMLElement, options: RegExp[]) {
  await userEvent.click(trigger)
  await waitFor(() =>
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(
      options.map((option) => expect.stringMatching(option)),
    ),
  )
  await userEvent.keyboard('{Escape}')
  await waitForListboxClosed()
}

const meta = preview.meta({
  title: 'Flows/FlowFormScreen',
  component: NewFlowScreen,
  parameters: { layout: 'fullscreen' },
  beforeEach({ msw }) {
    msw.use(...createHandlers(apiUrl))
  },
})

export const New = meta.story({
  async play({ canvas }) {
    await expect(
      canvas.getByRole('heading', { level: 1, name: 'New document route' }),
    ).toBeInTheDocument()
    await expect(canvas.getByRole('combobox', { name: 'Trading partner' })).toHaveTextContent(
      'Choose a trading partner',
    )
    await expect(canvas.getByRole('combobox', { name: 'Document type' })).toHaveTextContent(
      'ORDERS',
    )
    await waitFor(() =>
      expect(canvas.getByRole('combobox', { name: 'Version' })).toHaveTextContent(
        'Choose a version',
      ),
    )
  },
})

export const CreateFlow = meta.story({
  async play({ canvas }) {
    await userEvent.type(canvas.getByLabelText('Name'), 'Hansemarkt ORDERS from the shop')
    await waitFor(() =>
      expect(canvas.getByRole('combobox', { name: 'Trading partner' })).toBeEnabled(),
    )
    await choose(canvas.getByRole('combobox', { name: 'Trading partner' }), 'Hansemarkt GmbH')
    await choose(
      canvas.getByRole('combobox', { name: 'Inbound connection' }),
      /^Hansemarkt SFTP inbox/,
    )
    await choose(
      canvas.getByRole('combobox', { name: 'Destination connection' }),
      /^ERP HTTP delivery/,
    )
    await choose(
      canvas.getByRole('combobox', { name: 'Version' }),
      'Hansemarkt: ORDERS to ERP JSON, version 3',
    )
    await userEvent.click(canvas.getByRole('button', { name: 'Create document route' }))
    await waitFor(() =>
      expect(getRouter().push).toHaveBeenCalledWith(
        expect.stringMatching(/^\/flows\/[\da-f-]{36}$/),
      ),
    )
  },
})

export const OutboundMessageType = meta.story({
  async play({ canvas }) {
    await waitFor(() =>
      expect(canvas.getByRole('combobox', { name: 'Trading partner' })).toBeEnabled(),
    )
    await choose(canvas.getByRole('combobox', { name: 'Trading partner' }), 'Hansemarkt GmbH')
    await choose(
      canvas.getByRole('combobox', { name: 'Inbound connection' }),
      /^Hansemarkt SFTP inbox/,
    )
    await choose(canvas.getByRole('combobox', { name: 'Document type' }), 'DESADV')
    await expect(canvas.getByRole('combobox', { name: 'Inbound connection' })).toHaveTextContent(
      'Choose an inbound connection',
    )

    await expectOptions(canvas.getByRole('combobox', { name: 'Inbound connection' }), [
      /^ERP webhook/,
    ])
    await expectOptions(canvas.getByRole('combobox', { name: 'Destination connection' }), [
      /^Hansemarkt SFTP outbox/,
    ])
  },
})

export const ValidationErrors = meta.story({
  async play({ canvas }) {
    await userEvent.click(canvas.getByRole('button', { name: 'Create document route' }))
    await expect(canvas.getByLabelText('Name')).toHaveFocus()
    await expect(canvas.getByText('Choose a trading partner.')).toBeVisible()
    await expect(canvas.getByText('Choose a destination connection.')).toBeVisible()
    await expect(canvas.getByText('Choose a version.')).toBeVisible()
  },
})

export const NoPublishedMappingVersion = meta.story({
  beforeEach({ msw }) {
    msw.use(
      http.get(`${apiUrl}${publishedMappingVersionsEndpoint.path}`, () => HttpResponse.json([])),
    )
  },
  async play({ canvas }) {
    await expect(
      await canvas.findByText('No mapping version is published for ORDERS yet.'),
    ).toBeVisible()
  },
})

export const MappingVersionsUnavailable = meta.story({
  beforeEach({ msw }) {
    msw.use(
      http.get(`${apiUrl}${publishedMappingVersionsEndpoint.path}`, () =>
        HttpResponse.json({ message: 'Internal Server Error' }, { status: 500 }),
      ),
    )
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('The versions could not be loaded.')).toBeVisible()
  },
})

export const Edit = meta.story({
  render: () => <EditFlowScreen id={ordersFlow.id} />,
  async play({ canvas }) {
    await expect(await canvas.findByLabelText('Name')).toHaveValue('Hansemarkt ORDERS inbound')
    await expect(canvas.getByText('Hansemarkt: ORDERS to ERP JSON, version 3')).toBeVisible()
    await expect(canvas.getByText(/move the document route to it on its page/)).toBeVisible()
    await expect(canvas.queryByRole('combobox', { name: 'Version' })).toBeNull()
    await waitFor(() =>
      expect(canvas.getByRole('combobox', { name: 'Inbound connection' })).toHaveTextContent(
        'Hansemarkt SFTP inbox',
      ),
    )
  },
})

export const SaveFails = meta.story({
  render: () => <EditFlowScreen id={ordersFlow.id} />,
  beforeEach({ msw }) {
    msw.use(failingUpdate(500))
  },
  async play({ canvas }) {
    await userEvent.click(await canvas.findByRole('button', { name: 'Save changes' }))
    await expect(await canvas.findByRole('alert')).toHaveTextContent(
      'The document route could not be saved.',
    )
  },
})

export const ReferenceNoLongerFits = meta.story({
  render: () => <EditFlowScreen id={ordersFlow.id} />,
  beforeEach({ msw }) {
    msw.use(failingUpdate(422))
  },
  async play({ canvas }) {
    await userEvent.click(await canvas.findByRole('button', { name: 'Save changes' }))
    await expect(await canvas.findByRole('alert')).toHaveTextContent(
      'A chosen connection or version no longer fits this document route.',
    )
  },
})

export const EditNotFound = meta.story({
  render: () => <EditFlowScreen id="20000000-0000-4000-8000-0000000000ff" />,
  async play({ canvas }) {
    await expect(await canvas.findByText('Document route not found')).toBeVisible()
  },
})

export const EditLoading = meta.story({
  render: () => <EditFlowScreen id={ordersFlow.id} />,
  beforeEach({ msw }) {
    msw.use(
      http.get(`${apiUrl}${flowEndpoint.path}`, async () => {
        await delay('infinite')
      }),
    )
  },
  async play({ canvas }) {
    await expect(canvas.getByText('Loading document route')).toBeInTheDocument()
  },
})

export const EditChannelsLoading = meta.story({
  render: () => <EditFlowScreen id={ordersFlow.id} />,
  beforeEach({ msw }) {
    msw.use(
      http.get(`${apiUrl}${channelsEndpoint.path}`, async () => {
        await delay('infinite')
      }),
    )
  },
  async play({ canvas, canvasElement }) {
    await expect(await canvas.findByLabelText('Name')).toHaveValue('Hansemarkt ORDERS inbound')
    await expect(canvas.getByRole('combobox', { name: 'Inbound connection' })).toHaveTextContent(
      'Loading connections…',
    )
    await expect(
      canvas.getByRole('combobox', { name: 'Destination connection' }),
    ).toHaveTextContent('Loading connections…')
    await expect(canvasElement.querySelector('[aria-busy="true"]')).not.toBeNull()
  },
})

export const EditUnavailable = meta.story({
  render: () => <EditFlowScreen id={ordersFlow.id} />,
  beforeEach({ msw }) {
    msw.use(
      http.get(`${apiUrl}${flowEndpoint.path}`, () =>
        HttpResponse.json({ message: 'Internal Server Error' }, { status: 500 }),
      ),
    )
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('Document route unavailable')).toBeVisible()
  },
})

export const German = meta.story({
  decorators: [
    (Story) => (
      <NextIntlClientProvider locale="de" messages={messagesDe} timeZone="Europe/Berlin">
        <Story />
      </NextIntlClientProvider>
    ),
  ],
  async play({ canvas }) {
    await expect(canvas.getByRole('button', { name: 'Belegweg anlegen' })).toBeVisible()
  },
})

export const Dark = meta.story({
  render: () => <EditFlowScreen id={ordersFlow.id} />,
  beforeEach() {
    document.documentElement.classList.add('dark')

    return () => document.documentElement.classList.remove('dark')
  },
  async play({ canvas }) {
    await expect(await canvas.findByRole('button', { name: 'Save changes' })).toBeVisible()
  },
})
