import { delay, http, HttpResponse } from 'msw'
import { NextIntlClientProvider } from 'next-intl'
import { expect, userEvent, waitFor } from 'storybook/test'

import type { ReactNode } from 'react'

import { SettingsScreen } from '@/components/settings/settings-screen'
import { apiUrl } from '@/lib/api/config'
import messagesDe from '@/messages/de.json'
import {
  currentWorkspaceEndpoint,
  type Session,
  sessionEndpoint,
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

function darkMode() {
  document.documentElement.classList.add('dark')

  return () => document.documentElement.classList.remove('dark')
}

const german = (Story: () => ReactNode) => (
  <NextIntlClientProvider locale="de" messages={messagesDe} timeZone="Europe/Berlin">
    <Story />
  </NextIntlClientProvider>
)

const exhausted = createWorkspaceSettings({
  aiTokenBudget: { dailyLimit: 200_000, usedToday: 200_000 },
})

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
    await expect(canvas.getByRole('progressbar', { name: 'Used today' })).toHaveAttribute(
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
    const limit = canvas.getByLabelText('Daily limit in tokens')
    await userEvent.clear(limit)
    await userEvent.type(limit, '40000')
    await userEvent.click(canvas.getByRole('button', { name: 'Save retention and AI budget' }))
    await expect(await canvas.findByText('Retention and AI budget saved.')).toBeVisible()
    await expect(limit).toHaveValue('40,000')
  },
})

export const SaveKeepsFocus = meta.story({
  beforeEach({ msw }) {
    msw.use(
      http.put(`${apiUrl}${updateWorkspaceSettingsEndpoint.path}`, async () => {
        await delay('infinite')
      }),
    )
  },
  async play({ canvas }) {
    const save = await canvas.findByRole('button', { name: 'Save retention and AI budget' })
    save.focus()
    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(save).toHaveAttribute('aria-disabled', 'true'))
    await expect(save).toHaveTextContent('Saving…')
    await expect(save).toHaveFocus()
  },
})

export const SessionUnavailable = meta.story({
  beforeEach({ msw }) {
    msw.use(
      http.get(`${apiUrl}${sessionEndpoint.path}`, () =>
        HttpResponse.json({ message: 'Internal Server Error' }, { status: 500 }),
      ),
    )
  },
  async play({ canvas }) {
    await expect(await canvas.findByText(/The Operator sets the retention period/)).toBeVisible()
    await expect(canvas.queryByRole('textbox')).toBeNull()
    await expect(canvas.queryByRole('button')).toBeNull()
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

export const ViewerReadOnlyGerman = meta.story({
  beforeEach({ msw }) {
    msw.use(...signedInAs(showcaseViewerSession))
  },
  decorators: [german],
  async play({ canvas }) {
    await expect(await canvas.findByText(/Der Operator legt die Aufbewahrungsdauer/)).toBeVisible()
    await expect(canvas.getByText('90 Tage')).toBeVisible()
    await expect(canvas.getByText('200.000 Tokens pro Tag')).toBeVisible()
    await expect(canvas.queryByRole('textbox')).toBeNull()
  },
})

export const ViewerReadOnlyDark = meta.story({
  beforeEach({ msw }) {
    msw.use(...signedInAs(showcaseViewerSession))

    return darkMode()
  },
  async play({ canvas }) {
    await expect(await canvas.findByText(/The Operator sets the retention period/)).toBeVisible()
    await expect(canvas.getByRole('progressbar', { name: 'Used today' })).toBeVisible()
  },
})

export const BudgetExhausted = meta.story({
  beforeEach({ msw }) {
    msw.use(...signedInAs(seedSession, exhausted))
  },
  async play({ canvas }) {
    await expect(await canvas.findByText(/AI token budget is used up/)).toBeVisible()
    await expect(canvas.getByText('200,000 of 200,000 tokens (100%)')).toBeVisible()
  },
})

export const BudgetExhaustedGerman = meta.story({
  beforeEach({ msw }) {
    msw.use(...signedInAs(seedSession, exhausted))
  },
  decorators: [german],
  async play({ canvas }) {
    await expect(
      await canvas.findByText(/KI-Token-Budget für heute ist aufgebraucht/),
    ).toBeVisible()
    await expect(canvas.getByText('200.000 von 200.000 Tokens (100 %)')).toBeVisible()
  },
})

export const BudgetExhaustedDark = meta.story({
  beforeEach({ msw }) {
    msw.use(...signedInAs(seedSession, exhausted))

    return darkMode()
  },
  async play({ canvas }) {
    await expect(await canvas.findByText(/AI token budget is used up/)).toBeVisible()
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

export const ValidationErrorGerman = meta.story({
  decorators: [german],
  async play({ canvas }) {
    const retention = await canvas.findByLabelText('Aufbewahrungsdauer in Tagen')
    const limit = canvas.getByLabelText('Tageslimit in Tokens')
    await userEvent.clear(retention)
    await userEvent.type(retention, '3')
    await userEvent.clear(limit)
    await userEvent.type(limit, '1,500')
    await userEvent.click(
      canvas.getByRole('button', { name: 'Aufbewahrung und KI-Budget speichern' }),
    )
    await expect(
      await canvas.findByText('Geben Sie einen Wert zwischen 7 und 730 Tagen ein.'),
    ).toBeVisible()
    await expect(canvas.getByText('Geben Sie eine ganze Zahl von Tokens ein.')).toBeVisible()
    await expect(limit).toHaveAttribute('aria-invalid', 'true')
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
  decorators: [german],
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

    return darkMode()
  },
  async play({ canvas }) {
    await expect(await canvas.findByLabelText('GLN')).toBeVisible()
    await expect(await canvas.findByRole('progressbar', { name: 'Used today' })).toBeVisible()
  },
})
