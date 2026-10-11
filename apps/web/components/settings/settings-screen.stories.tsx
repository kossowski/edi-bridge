import { delay, http, HttpResponse } from 'msw'
import { NextIntlClientProvider } from 'next-intl'
import { expect, userEvent } from 'storybook/test'

import { SettingsScreen } from '@/components/settings/settings-screen'
import { apiUrl } from '@/lib/api/config'
import messagesDe from '@/messages/de.json'
import {
  currentWorkspaceEndpoint,
  type Session,
  updateWorkspaceSettingsEndpoint,
  workspaceSettingsEndpoint,
  type WorkspaceSettings,
} from '@edi-bridge/contracts'
import {
  createSessionStore,
  createWorkspace,
  createWorkspaceSettings,
  sandboxAdminSession,
  seedSession,
  seedWorkspace,
  sessionHandlers,
  showcaseViewerSession,
  workspaceHandlers,
  workspaceSettingsHandlers,
} from '@edi-bridge/mocks'

import preview from '../../.storybook/preview'

function signedInAs(session: Session, settings?: WorkspaceSettings) {
  const store = createSessionStore(session)

  return [
    ...sessionHandlers(apiUrl, store),
    ...workspaceHandlers(apiUrl, seedWorkspace, store),
    ...workspaceSettingsHandlers(apiUrl, { session: store, ...(settings && { settings }) }),
  ]
}

const largeNumbers = createWorkspaceSettings({
  documentRetentionDays: 730,
  aiTokenBudget: { dailyLimit: 10_000_000, usedToday: 9_876_543 },
})

const meta = preview.meta({
  title: 'Settings/SettingsScreen',
  component: SettingsScreen,
  parameters: { layout: 'fullscreen' },
  beforeEach({ msw }) {
    msw.use(...signedInAs(seedSession))
  },
})

export const Default = meta.story({
  async play({ canvas }) {
    await expect(await canvas.findByLabelText('GLN')).toHaveValue(seedWorkspace.gln)
    await expect(await canvas.findByLabelText('Retention period in days')).toHaveValue('90')
    await expect(canvas.getByLabelText('Daily limit in tokens')).toHaveValue('200,000')
    await expect(canvas.getByRole('meter', { name: 'Used today' })).toHaveAttribute(
      'aria-valuetext',
      '48,350 of 200,000 tokens (24%)',
    )
  },
})

export const OperatorSaves = meta.story({
  async play({ canvas }) {
    const retention = await canvas.findByLabelText('Retention period in days')
    await userEvent.clear(retention)
    await userEvent.type(retention, '30')
    await userEvent.click(canvas.getByRole('button', { name: 'Save retention and AI budget' }))
    await expect(await canvas.findByText('Retention and AI budget saved.')).toBeVisible()
  },
})

export const AdminReadOnly = meta.story({
  beforeEach({ msw }) {
    msw.use(...signedInAs(sandboxAdminSession))
  },
  async play({ canvas }) {
    await expect(await canvas.findByText(/The Operator sets the retention period/)).toBeVisible()
    await expect(canvas.getByText('90 days')).toBeVisible()
    await expect(canvas.getByText('200,000 tokens per day')).toBeVisible()
    await expect(canvas.queryByLabelText('Retention period in days')).toBeNull()
    await expect(canvas.getByLabelText('GLN')).toHaveValue(seedWorkspace.gln)
  },
})

export const ViewerReadOnly = meta.story({
  beforeEach({ msw }) {
    msw.use(...signedInAs(showcaseViewerSession))
  },
  async play({ canvas }) {
    await expect(await canvas.findByText(/The Operator sets the retention period/)).toBeVisible()
    await expect(canvas.getByText(seedWorkspace.gln ?? '')).toBeVisible()
    await expect(canvas.queryByRole('textbox')).toBeNull()
    await expect(canvas.queryByRole('button')).toBeNull()
  },
})

export const BudgetExhausted = meta.story({
  beforeEach({ msw }) {
    msw.use(
      ...signedInAs(
        seedSession,
        createWorkspaceSettings({ aiTokenBudget: { dailyLimit: 200_000, usedToday: 200_000 } }),
      ),
    )
  },
  async play({ canvas }) {
    await expect(await canvas.findByText(/AI token budget is used up/)).toBeVisible()
    await expect(canvas.getByText('200,000 of 200,000 tokens (100%)')).toBeVisible()
  },
})

export const AiTurnedOff = meta.story({
  beforeEach({ msw }) {
    msw.use(
      ...signedInAs(
        sandboxAdminSession,
        createWorkspaceSettings({ aiTokenBudget: { dailyLimit: 0, usedToday: 0 } }),
      ),
    )
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('AI is turned off for this Workspace.')).toBeVisible()
  },
})

export const LargeNumbers = meta.story({
  beforeEach({ msw }) {
    msw.use(...signedInAs(sandboxAdminSession, largeNumbers))
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('730 days')).toBeVisible()
    await expect(canvas.getByText('10,000,000 tokens per day')).toBeVisible()
    await expect(canvas.getByText('9,876,543 of 10,000,000 tokens (99%)')).toBeVisible()
  },
})

export const ValidationError = meta.story({
  async play({ canvas }) {
    const retention = await canvas.findByLabelText('Retention period in days')
    const limit = canvas.getByLabelText('Daily limit in tokens')
    await userEvent.clear(retention)
    await userEvent.type(retention, '3')
    await userEvent.clear(limit)
    await userEvent.type(limit, '1.5')
    await userEvent.click(canvas.getByRole('button', { name: 'Save retention and AI budget' }))
    await expect(await canvas.findByText('Enter between 7 and 730 days.')).toBeVisible()
    await expect(canvas.getByText('Enter a whole number of tokens.')).toBeVisible()
    await expect(retention).toHaveAttribute('aria-invalid', 'true')
  },
})

export const SaveFailed = meta.story({
  beforeEach({ msw }) {
    msw.use(
      http.put(`${apiUrl}${updateWorkspaceSettingsEndpoint.path}`, () =>
        HttpResponse.json({ message: 'Internal Server Error' }, { status: 500 }),
      ),
    )
  },
  async play({ canvas }) {
    await userEvent.click(
      await canvas.findByRole('button', { name: 'Save retention and AI budget' }),
    )
    await expect(await canvas.findByRole('alert')).toHaveTextContent(
      'The retention period and AI budget could not be saved. Try again.',
    )
  },
})

export const SettingsUnavailable = meta.story({
  beforeEach({ msw }) {
    msw.use(
      http.get(`${apiUrl}${workspaceSettingsEndpoint.path}`, () =>
        HttpResponse.json({ message: 'Internal Server Error' }, { status: 500 }),
      ),
    )
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('Settings unavailable')).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Try again' })).toBeVisible()
    await expect(await canvas.findByLabelText('GLN')).toBeVisible()
  },
})

export const SavedThenEdited = meta.story({
  async play({ canvas }) {
    const gln = await canvas.findByLabelText('GLN')
    await userEvent.click(canvas.getByRole('button', { name: 'Save company identity' }))
    await expect(await canvas.findByText('Company identity saved.')).toBeVisible()

    await userEvent.type(gln, '1')
    await expect(canvas.queryByText('Company identity saved.')).toBeNull()
  },
})

export const WithoutGln = meta.story({
  beforeEach({ msw }) {
    msw.use(
      ...workspaceHandlers(apiUrl, createWorkspace({ name: 'Ostsee Feinkost AG', gln: null })),
    )
  },
  async play({ canvas }) {
    await expect(await canvas.findByText(/Your company has no GLN yet/)).toBeVisible()
  },
})

export const Loading = meta.story({
  beforeEach({ msw }) {
    msw.use(
      http.get(`${apiUrl}${currentWorkspaceEndpoint.path}`, async () => {
        await delay('infinite')
      }),
      http.get(`${apiUrl}${workspaceSettingsEndpoint.path}`, async () => {
        await delay('infinite')
      }),
    )
  },
  async play({ canvas }) {
    await expect(canvas.getAllByText('Loading settings')).toHaveLength(2)
  },
})

export const Unavailable = meta.story({
  beforeEach({ msw }) {
    msw.use(
      http.get(`${apiUrl}${currentWorkspaceEndpoint.path}`, () =>
        HttpResponse.json({ message: 'Internal Server Error' }, { status: 500 }),
      ),
    )
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('Settings unavailable')).toBeVisible()
  },
})

export const German = meta.story({
  beforeEach({ msw }) {
    msw.use(...signedInAs(seedSession, largeNumbers))
  },
  decorators: [
    (Story) => (
      <NextIntlClientProvider locale="de" messages={messagesDe} timeZone="Europe/Berlin">
        <Story />
      </NextIntlClientProvider>
    ),
  ],
  async play({ canvas }) {
    await expect(
      await canvas.findByRole('heading', { name: 'Unternehmensidentität' }),
    ).toBeVisible()
    await expect(await canvas.findByLabelText('Tageslimit in Tokens')).toHaveValue('10.000.000')
    await expect(canvas.getByText('9.876.543 von 10.000.000 Tokens (99 %)')).toBeVisible()
  },
})

export const Dark = meta.story({
  beforeEach({ msw }) {
    msw.use(
      ...signedInAs(
        seedSession,
        createWorkspaceSettings({ aiTokenBudget: { dailyLimit: 200_000, usedToday: 210_000 } }),
      ),
    )
    document.documentElement.classList.add('dark')

    return () => document.documentElement.classList.remove('dark')
  },
  async play({ canvas }) {
    await expect(await canvas.findByLabelText('GLN')).toBeVisible()
    await expect(await canvas.findByRole('meter', { name: 'Used today' })).toBeVisible()
  },
})
