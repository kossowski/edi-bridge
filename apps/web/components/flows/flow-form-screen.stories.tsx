import { getRouter } from '@storybook/nextjs-vite/navigation.mock'
import { delay, http, HttpResponse } from 'msw'
import { NextIntlClientProvider } from 'next-intl'
import { expect, screen, userEvent, waitFor } from 'storybook/test'

import { EditFlowScreen, NewFlowScreen } from '@/components/flows/flow-form-screen'
import { apiUrl } from '@/lib/api/config'
import messagesDe from '@/messages/de.json'
import {
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

async function choose(trigger: HTMLElement, option: string | RegExp) {
  await userEvent.click(trigger)
  await userEvent.click(await screen.findByRole('option', { name: option }))
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
    await expect(canvas.getByRole('heading', { name: 'New Flow' })).toBeVisible()
    await expect(canvas.getByRole('combobox', { name: 'Trading Partner' })).toHaveTextContent(
      'Choose a Trading Partner',
    )
    await expect(canvas.getByRole('combobox', { name: 'Message Type' })).toHaveTextContent('ORDERS')
    await waitFor(() =>
      expect(canvas.getByRole('combobox', { name: 'Mapping Version' })).toHaveTextContent(
        'Choose a Mapping Version',
      ),
    )
  },
})

export const CreateFlow = meta.story({
  async play({ canvas }) {
    await userEvent.type(canvas.getByLabelText('Name'), 'Hansemarkt ORDERS from the shop')
    await waitFor(() =>
      expect(canvas.getByRole('combobox', { name: 'Trading Partner' })).toBeEnabled(),
    )
    await choose(canvas.getByRole('combobox', { name: 'Trading Partner' }), 'Hansemarkt GmbH')
    await choose(
      canvas.getByRole('combobox', { name: 'Inbound Channel' }),
      /^Hansemarkt SFTP inbox/,
    )
    await choose(
      canvas.getByRole('combobox', { name: 'Destination Channel' }),
      /^ERP HTTP delivery/,
    )
    await choose(
      canvas.getByRole('combobox', { name: 'Mapping Version' }),
      'Hansemarkt: ORDERS to ERP JSON, version 3',
    )
    await userEvent.click(canvas.getByRole('button', { name: 'Create Flow' }))
    await waitFor(() =>
      expect(getRouter().push).toHaveBeenCalledWith(
        expect.stringMatching(/^\/flows\/[\da-f-]{36}$/),
      ),
    )
  },
})

export const ValidationErrors = meta.story({
  async play({ canvas }) {
    await userEvent.click(canvas.getByRole('button', { name: 'Create Flow' }))
    await expect(canvas.getByLabelText('Name')).toHaveFocus()
    await expect(canvas.getByText('Choose a Trading Partner.')).toBeVisible()
    await expect(canvas.getByText('Choose a destination Channel.')).toBeVisible()
    await expect(canvas.getByText('Choose a Mapping Version.')).toBeVisible()
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
      await canvas.findByText('No Mapping Version is published for ORDERS yet.'),
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
    await expect(await canvas.findByText('The Mapping Versions could not be loaded.')).toBeVisible()
  },
})

export const Edit = meta.story({
  render: () => <EditFlowScreen id={ordersFlow.id} />,
  async play({ canvas }) {
    await expect(await canvas.findByLabelText('Name')).toHaveValue('Hansemarkt ORDERS inbound')
    await expect(canvas.getByText('Hansemarkt: ORDERS to ERP JSON, version 3')).toBeVisible()
    await expect(canvas.getByText(/move the Flow to it on the Flow's page/)).toBeVisible()
    await expect(canvas.queryByRole('combobox', { name: 'Mapping Version' })).toBeNull()
    await waitFor(() =>
      expect(canvas.getByRole('combobox', { name: 'Inbound Channel' })).toHaveTextContent(
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
    await expect(await canvas.findByRole('alert')).toHaveTextContent('The Flow could not be saved.')
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
      'A chosen Channel or Mapping Version no longer fits this Flow.',
    )
  },
})

export const EditNotFound = meta.story({
  render: () => <EditFlowScreen id="20000000-0000-4000-8000-0000000000ff" />,
  async play({ canvas }) {
    await expect(await canvas.findByText('Flow not found')).toBeVisible()
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
    await expect(canvas.getByText('Loading Flow')).toBeInTheDocument()
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
    await expect(await canvas.findByText('Flow unavailable')).toBeVisible()
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
    await expect(canvas.getByRole('button', { name: 'Flow anlegen' })).toBeVisible()
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
