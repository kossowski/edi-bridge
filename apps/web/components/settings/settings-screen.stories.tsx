import { getRouter } from '@storybook/nextjs-vite/navigation.mock'
import { delay, http, HttpResponse } from 'msw'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { AppHeader } from '@/components/app-header'
import { sessionHandlers } from '@/components/session/session-story-helpers'
import { SettingsScreen } from '@/components/settings/settings-screen'
import { darkMode, german } from '@/components/story-helpers'
import { apiUrl } from '@/lib/api/config'
import {
  currentWorkspaceEndpoint,
  type Session,
  updateCompanyIdentityEndpoint,
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
  showcaseViewerSession,
  workspaceHandlers,
  workspaceSettingsHandlers,
} from '@edi-bridge/mocks'
import { SidebarProvider } from '@edi-bridge/ui/components/sidebar'

import preview from '../../.storybook/preview'

const withoutGln = createWorkspace({ name: seedWorkspace.name, gln: null })

function signedInAs(
  session: Session,
  { settings, missingGln = false }: { settings?: WorkspaceSettings; missingGln?: boolean } = {},
) {
  const store = createSessionStore(session)

  return [
    ...sessionHandlers(store),
    ...workspaceHandlers(apiUrl, missingGln ? withoutGln : seedWorkspace, store),
    ...workspaceSettingsHandlers(apiUrl, { session: store, ...(settings && { settings }) }),
  ]
}

function failing(path: string, method: 'get' | 'put' = 'get') {
  return http[method](`${apiUrl}${path}`, () =>
    HttpResponse.json({ message: 'Internal Server Error' }, { status: 500 }),
  )
}

function pending(path: string) {
  return http.get(`${apiUrl}${path}`, async () => {
    await delay('infinite')
  })
}

function panel(canvasElement: HTMLElement) {
  return within(within(canvasElement).getByRole('tabpanel'))
}

const dataTab = { parameters: { nextjs: { navigation: { query: { tab: 'data' } } } } }

const exhausted = createWorkspaceSettings({
  aiTokenBudget: { dailyLimit: 200_000, usedToday: 200_000 },
})

const turnedOff = createWorkspaceSettings({ aiTokenBudget: { dailyLimit: 0, usedToday: 0 } })

const largeNumbers = createWorkspaceSettings({
  documentRetentionDays: 730,
  aiTokenBudget: { dailyLimit: 10_000_000, usedToday: 9_876_543 },
})

const meta = preview.meta({
  title: 'Settings/SettingsScreen',
  component: SettingsScreen,
  parameters: {
    layout: 'fullscreen',
    nextjs: { navigation: { pathname: '/settings', query: {} } },
  },
  decorators: [
    (Story) => (
      <SidebarProvider>
        <div className="w-full">
          <AppHeader />
          <Story />
        </div>
      </SidebarProvider>
    ),
  ],
  beforeEach({ msw }) {
    msw.use(...signedInAs(sandboxAdminSession))
  },
})

export const CompanyAsAdmin = meta.story({
  async play({ canvas, canvasElement }) {
    await expect(
      await canvas.findByRole('heading', { level: 1, name: 'Settings' }),
    ).toBeInTheDocument()
    await expect(await canvas.findByRole('tab', { name: 'Company' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await expect(canvas.getByRole('tab', { name: 'Data & AI' })).toBeVisible()
    await expect(canvas.queryByRole('tab', { name: /Notifications/ })).toBeNull()
    await expect(await canvas.findByLabelText('Company ID (GLN)')).toHaveValue(seedWorkspace.gln)
    const company = panel(canvasElement)
    await expect(company.getByText('This is how your partners see you.')).toBeVisible()
    await expect(company.getByText(seedWorkspace.name)).toBeVisible()
    await expect(company.queryByText('Your company ID is missing')).toBeNull()
  },
})

export const CompanySaved = meta.story({
  async play({ canvas }) {
    const gln = await canvas.findByLabelText('Company ID (GLN)')
    await userEvent.click(canvas.getByRole('button', { name: 'Save' }))
    await expect(await canvas.findByText('Company ID saved.')).toBeVisible()

    await userEvent.type(gln, '1')
    await expect(canvas.queryByText('Company ID saved.')).toBeNull()
  },
})

export const CompanyInvalidGln = meta.story({
  async play({ canvas }) {
    const gln = await canvas.findByLabelText('Company ID (GLN)')
    await userEvent.clear(gln)
    await userEvent.type(gln, '123')
    await userEvent.click(canvas.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(gln).toHaveAttribute('aria-invalid', 'true'))
  },
})

export const CompanySaveFailed = meta.story({
  beforeEach({ msw }) {
    msw.use(failing(updateCompanyIdentityEndpoint.path, 'put'))
  },
  async play({ canvas }) {
    await userEvent.click(await canvas.findByRole('button', { name: 'Save' }))
    await expect(await canvas.findByRole('alert')).toHaveTextContent(
      'The company ID could not be saved. Try again.',
    )
  },
})

export const CompanyAsViewer = meta.story({
  beforeEach({ msw }) {
    msw.use(...signedInAs(showcaseViewerSession))
  },
  async play({ canvas, canvasElement }) {
    await expect(await canvas.findByText(seedWorkspace.gln ?? '')).toBeVisible()
    const company = panel(canvasElement)
    await expect(company.getByText(seedWorkspace.name)).toBeVisible()
    await expect(company.queryByRole('textbox')).toBeNull()
    await expect(company.queryByRole('button')).toBeNull()
  },
})

export const CompanyWithoutGln = meta.story({
  beforeEach({ msw }) {
    msw.use(...signedInAs(sandboxAdminSession, { missingGln: true }))
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('Your company ID is missing')).toBeVisible()
    await expect(canvas.getByText(/Add your GLN below/)).toBeVisible()
    await expect(canvas.getByLabelText('Company ID (GLN)')).toHaveValue('')
  },
})

export const CompanyWithoutGlnAsViewer = meta.story({
  beforeEach({ msw }) {
    msw.use(...signedInAs(showcaseViewerSession, { missingGln: true }))
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('Your company ID is missing')).toBeVisible()
    await expect(canvas.getByText(/Ask an Admin of your company/)).toBeVisible()
    await expect(canvas.getByText('Not set')).toBeVisible()
  },
})

export const CompanyLoading = meta.story({
  beforeEach({ msw }) {
    msw.use(pending(currentWorkspaceEndpoint.path))
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('Loading settings')).toBeInTheDocument()
  },
})

export const CompanyUnavailable = meta.story({
  beforeEach({ msw }) {
    msw.use(failing(currentWorkspaceEndpoint.path))
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('Settings unavailable')).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Try again' })).toBeVisible()
  },
})

export const CompanyGerman = meta.story({
  decorators: [german],
  async play({ canvas }) {
    await expect(await canvas.findByRole('tab', { name: 'Unternehmen' })).toBeVisible()
    await expect(canvas.getByRole('tab', { name: 'Daten & KI' })).toBeVisible()
    await expect(await canvas.findByLabelText('Unternehmens-ID (GLN)')).toHaveValue(
      seedWorkspace.gln,
    )
    await expect(canvas.getByText('So sehen Ihre Partner Sie.')).toBeVisible()
  },
})

export const CompanyWithoutGlnGerman = meta.story({
  beforeEach({ msw }) {
    msw.use(...signedInAs(showcaseViewerSession, { missingGln: true }))
  },
  decorators: [german],
  async play({ canvas }) {
    await expect(await canvas.findByText('Ihre Unternehmens-ID fehlt')).toBeVisible()
  },
})

export const CompanyDark = meta.story({
  beforeEach({ msw }) {
    msw.use(...signedInAs(sandboxAdminSession, { missingGln: true }))

    return darkMode()
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('Your company ID is missing')).toBeVisible()
    await expect(canvas.getByLabelText('Company ID (GLN)')).toBeVisible()
  },
})

export const ChooseDataTab = meta.story({
  async play({ canvas }) {
    await userEvent.click(await canvas.findByRole('tab', { name: 'Data & AI' }))
    await expect(getRouter().replace).toHaveBeenCalledWith('/settings?tab=data', {
      scroll: false,
    })
  },
})

export const UnknownTabShowsCompany = meta.story({
  parameters: { nextjs: { navigation: { query: { tab: 'notifications' } } } },
  async play({ canvas }) {
    await expect(await canvas.findByRole('tab', { name: 'Company' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await expect(await canvas.findByLabelText('Company ID (GLN)')).toBeVisible()
  },
})

export const DataAndAi = meta.story({
  ...dataTab,
  async play({ canvas, canvasElement }) {
    await expect(await canvas.findByRole('tab', { name: 'Data & AI' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await expect(await canvas.findByText('Set by the Operator')).toBeVisible()
    const data = panel(canvasElement)
    await expect(data.getByText('90 days')).toBeVisible()
    await expect(data.getByText(/process a document again only while it is kept/)).toBeVisible()
    await expect(data.getByText('76% of today’s AI budget is left.')).toBeVisible()
    await expect(data.getByText(/AI stops drafting mappings until tomorrow/)).toBeVisible()
    await expect(data.getByRole('progressbar', { name: 'Tokens used today' })).toHaveAttribute(
      'aria-valuetext',
      '48,350 of 200,000 tokens (24%)',
    )
    await expect(data.queryByRole('textbox')).toBeNull()
    await expect(data.queryByRole('button')).toBeNull()
    await expect(data.queryByRole('link')).toBeNull()
  },
})

export const DataAndAiAsOperator = meta.story({
  ...dataTab,
  beforeEach({ msw }) {
    msw.use(...signedInAs(seedSession))
  },
  async play({ canvas, canvasElement }) {
    await expect(await canvas.findByText('Set by the Operator')).toBeVisible()
    await expect(panel(canvasElement).queryByRole('textbox')).toBeNull()
  },
})

export const DataAndAiAsViewer = meta.story({
  ...dataTab,
  beforeEach({ msw }) {
    msw.use(...signedInAs(showcaseViewerSession))
  },
  async play({ canvas, canvasElement }) {
    await expect(await canvas.findByText('90 days')).toBeVisible()
    await expect(panel(canvasElement).queryByRole('textbox')).toBeNull()
  },
})

export const BudgetExhausted = meta.story({
  ...dataTab,
  beforeEach({ msw }) {
    msw.use(...signedInAs(sandboxAdminSession, { settings: exhausted }))
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('Today’s AI budget is used up')).toBeVisible()
    await expect(canvas.getByText(/cannot draft mappings until tomorrow/)).toBeVisible()
    await expect(canvas.queryByText(/budget is left/)).toBeNull()
    await expect(canvas.getByText('200,000 of 200,000 tokens (100%)')).toBeVisible()
  },
})

export const AiTurnedOff = meta.story({
  ...dataTab,
  beforeEach({ msw }) {
    msw.use(...signedInAs(sandboxAdminSession, { settings: turnedOff }))
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('AI is turned off')).toBeVisible()
    await expect(canvas.queryByRole('progressbar')).toBeNull()
    await expect(canvas.queryByText(/budget is left/)).toBeNull()
  },
})

export const LargeNumbers = meta.story({
  ...dataTab,
  beforeEach({ msw }) {
    msw.use(...signedInAs(sandboxAdminSession, { settings: largeNumbers }))
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('730 days')).toBeVisible()
    await expect(canvas.getByText('1% of today’s AI budget is left.')).toBeVisible()
    await expect(canvas.getByText('9,876,543 of 10,000,000 tokens (99%)')).toBeVisible()
  },
})

export const DataAndAiLoading = meta.story({
  ...dataTab,
  beforeEach({ msw }) {
    msw.use(pending(workspaceSettingsEndpoint.path))
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('Loading settings')).toBeInTheDocument()
  },
})

export const DataAndAiUnavailable = meta.story({
  ...dataTab,
  beforeEach({ msw }) {
    msw.use(failing(workspaceSettingsEndpoint.path))
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('Settings unavailable')).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Try again' })).toBeVisible()
  },
})

export const DataAndAiGerman = meta.story({
  ...dataTab,
  beforeEach({ msw }) {
    msw.use(...signedInAs(sandboxAdminSession, { settings: largeNumbers }))
  },
  decorators: [german],
  async play({ canvas }) {
    await expect(await canvas.findByText('Vom Operator festgelegt')).toBeVisible()
    await expect(canvas.getByText('730 Tage')).toBeVisible()
    await expect(canvas.getByText(/des heutigen KI-Budgets sind noch übrig/)).toBeVisible()
    await expect(canvas.getByText('9.876.543 von 10.000.000 Tokens (99 %)')).toBeVisible()
  },
})

export const BudgetExhaustedGerman = meta.story({
  ...dataTab,
  beforeEach({ msw }) {
    msw.use(...signedInAs(sandboxAdminSession, { settings: exhausted }))
  },
  decorators: [german],
  async play({ canvas }) {
    await expect(await canvas.findByText('Das KI-Budget für heute ist aufgebraucht')).toBeVisible()
  },
})

export const DataAndAiDark = meta.story({
  ...dataTab,
  beforeEach({ msw }) {
    msw.use(...signedInAs(sandboxAdminSession, { settings: exhausted }))

    return darkMode()
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('Today’s AI budget is used up')).toBeVisible()
    await expect(canvas.getByRole('progressbar', { name: 'Tokens used today' })).toBeVisible()
  },
})

export const AiTurnedOffDark = meta.story({
  ...dataTab,
  beforeEach({ msw }) {
    msw.use(...signedInAs(sandboxAdminSession, { settings: turnedOff }))

    return darkMode()
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('AI is turned off')).toBeVisible()
  },
})
