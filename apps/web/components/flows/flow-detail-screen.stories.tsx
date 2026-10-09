import { delay, http, HttpResponse } from 'msw'
import { NextIntlClientProvider } from 'next-intl'
import { expect, userEvent, waitFor } from 'storybook/test'

import { FlowDetailScreen } from '@/components/flows/flow-detail-screen'
import { apiUrl } from '@/lib/api/config'
import messagesDe from '@/messages/de.json'
import { flowEndpoint, moveFlowMappingVersionEndpoint } from '@edi-bridge/contracts'
import { createHandlers, seedFlows } from '@edi-bridge/mocks'

import preview from '../../.storybook/preview'

function seeded(name: string) {
  return seedFlows.find((flow) => flow.name === name)!
}

const newest = seeded('Hansemarkt ORDERS inbound')

const oneBehind = seeded('Hansemarkt DESADV outbound')

const twoBehind = seeded('Hansemarkt CONTRL inbound')

const meta = preview.meta({
  title: 'Flows/FlowDetailScreen',
  component: FlowDetailScreen,
  parameters: { layout: 'fullscreen' },
  beforeEach({ msw }) {
    msw.use(...createHandlers(apiUrl))
  },
})

export const NewestVersion = meta.story({
  args: { id: newest.id },
  async play({ canvas }) {
    await expect(
      await canvas.findByRole('heading', { name: 'Hansemarkt ORDERS inbound' }),
    ).toBeVisible()
    await expect(await canvas.findByRole('link', { name: 'Hansemarkt GmbH' })).toBeVisible()
    await expect(await canvas.findByRole('link', { name: 'Hansemarkt SFTP inbox' })).toBeVisible()
    await expect(canvas.getByRole('link', { name: 'ERP HTTP delivery' })).toBeVisible()
    await expect(canvas.getByText('Hansemarkt: ORDERS to ERP JSON, version 3')).toBeVisible()
    await expect(canvas.getByText('This is the newest published version.')).toBeVisible()
    await expect(canvas.queryByRole('button', { name: 'Move to a newer version' })).toBeNull()
  },
})

export const NewerVersionAvailable = meta.story({
  args: { id: oneBehind.id },
  async play({ canvas }) {
    await expect(await canvas.findByText('A newer version is available: version 4.')).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Move to a newer version' })).toBeVisible()
  },
})

export const MoveToNewerVersion = meta.story({
  args: { id: twoBehind.id },
  async play({ canvas }) {
    await expect(
      await canvas.findByText('2 newer versions are available, up to version 4.'),
    ).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Move to a newer version' }))
    await expect(canvas.getByText(/Runs already processed keep the version/)).toHaveFocus()
    await expect(canvas.getByRole('radio', { name: /^Version 4/ })).toBeChecked()
    await userEvent.click(canvas.getByRole('radio', { name: /^Version 3/ }))
    await userEvent.click(canvas.getByRole('button', { name: 'Move to version 3' }))
    await waitFor(() => expect(canvas.getByText('The Flow now uses version 3.')).toHaveFocus())
    await expect(canvas.getByText('Hansemarkt: CONTRL to ERP JSON, version 3')).toBeVisible()
    await expect(canvas.getByText('A newer version is available: version 4.')).toBeVisible()
  },
})

export const CancelMove = meta.story({
  args: { id: oneBehind.id },
  async play({ canvas }) {
    await userEvent.click(await canvas.findByRole('button', { name: 'Move to a newer version' }))
    await userEvent.click(canvas.getByRole('button', { name: 'Cancel' }))
    await expect(canvas.getByRole('button', { name: 'Move to a newer version' })).toHaveFocus()
    await expect(canvas.getByText('Hansemarkt: ERP JSON to DESADV, version 3')).toBeVisible()
  },
})

export const MoveFails = meta.story({
  args: { id: oneBehind.id },
  beforeEach({ msw }) {
    msw.use(
      http.post(`${apiUrl}${moveFlowMappingVersionEndpoint.path}`, () =>
        HttpResponse.json({ message: 'Internal Server Error' }, { status: 500 }),
      ),
    )
  },
  async play({ canvas }) {
    await userEvent.click(await canvas.findByRole('button', { name: 'Move to a newer version' }))
    await userEvent.click(canvas.getByRole('button', { name: 'Move to version 4' }))
    await expect(await canvas.findByRole('alert')).toHaveTextContent('The Flow could not be moved.')
  },
})

export const NotFound = meta.story({
  args: { id: '20000000-0000-4000-8000-0000000000ff' },
  async play({ canvas }) {
    await expect(await canvas.findByText('Flow not found')).toBeVisible()
  },
})

export const Loading = meta.story({
  args: { id: newest.id },
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

export const Unavailable = meta.story({
  args: { id: newest.id },
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
  args: { id: twoBehind.id },
  decorators: [
    (Story) => (
      <NextIntlClientProvider locale="de" messages={messagesDe} timeZone="Europe/Berlin">
        <Story />
      </NextIntlClientProvider>
    ),
  ],
  async play({ canvas }) {
    await userEvent.click(
      await canvas.findByRole('button', { name: 'Auf neuere Version umstellen' }),
    )
    await expect(canvas.getByRole('button', { name: 'Auf Version 4 umstellen' })).toBeVisible()
  },
})

export const Dark = meta.story({
  args: { id: twoBehind.id },
  beforeEach() {
    document.documentElement.classList.add('dark')

    return () => document.documentElement.classList.remove('dark')
  },
  async play({ canvas }) {
    await userEvent.click(await canvas.findByRole('button', { name: 'Move to a newer version' }))
    await expect(canvas.getByRole('button', { name: 'Move to version 4' })).toBeVisible()
  },
})
