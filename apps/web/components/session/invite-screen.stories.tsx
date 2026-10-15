import { getRouter } from '@storybook/nextjs-vite/navigation.mock'
import { delay, http, HttpResponse } from 'msw'
import { expect, userEvent, waitFor } from 'storybook/test'

import { InviteScreen } from '@/components/session/invite-screen'
import { darkMode, german, mobile } from '@/components/story-helpers'
import { apiUrl } from '@/lib/api/config'
import {
  acceptInviteEndpoint,
  type Invite,
  inviteSchema,
  signInEndpoint,
} from '@edi-bridge/contracts'
import {
  createCredentialStore,
  createOperatorStore,
  createSessionStore,
  mockCredentials,
  operatorHandlers,
  seedWorkspace,
  sessionHandlers,
} from '@edi-bridge/mocks'

import preview from '../../.storybook/preview'

const day = 24 * 60 * 60 * 1000

const invitedEmail = 'jonas.weber@nordwind-handel.example'

function invite(token: string, changes: Partial<Invite> = {}): Invite {
  return inviteSchema.parse({
    id: crypto.randomUUID(),
    workspaceId: seedWorkspace.id,
    email: invitedEmail,
    role: 'viewer',
    link: `http://localhost:3000/invite/${token}`,
    createdAt: new Date(Date.now() - day).toISOString(),
    expiresAt: new Date(Date.now() + 6 * day).toISOString(),
    acceptedAt: null,
    revokedAt: null,
    ...changes,
  })
}

const invites = [
  invite('open'),
  invite('revoked', { revokedAt: new Date(Date.now() - day / 2).toISOString() }),
  invite('used', { acceptedAt: new Date(Date.now() - day / 2).toISOString() }),
  invite('expired', {
    createdAt: new Date(Date.now() - 8 * day).toISOString(),
    expiresAt: new Date(Date.now() - day).toISOString(),
  }),
  invite('existing-account', { email: mockCredentials.sandboxAdmin.email }),
]

const meta = preview.meta({
  title: 'Session/InviteScreen',
  component: InviteScreen,
  args: { token: 'open' },
  parameters: { layout: 'padded' },
  beforeEach({ msw }) {
    const session = createSessionStore(null)
    const credentials = createCredentialStore()

    msw.use(
      ...sessionHandlers(apiUrl, session, credentials),
      ...operatorHandlers(apiUrl, {
        workspaces: createOperatorStore({ invites }),
        session,
        credentials,
      }),
    )
  },
})

async function setPassword(
  canvas: { getByLabelText: (label: string) => HTMLElement },
  { name = 'Jonas Weber', password = 'jonas-password' } = {},
) {
  if (name !== '') {
    await userEvent.type(canvas.getByLabelText('Your name'), name)
  }

  if (password !== '') {
    await userEvent.type(canvas.getByLabelText('Password'), password)
  }
}

function submitButton(canvas: {
  getByRole: (role: 'button', options: { name: string }) => HTMLElement
}) {
  return canvas.getByRole('button', { name: 'Set password and sign in' })
}

export const Default = meta.story({
  async play({ canvas }) {
    await expect(canvas.getByRole('heading', { level: 1, name: 'Set your password' })).toBeVisible()
    await expect(canvas.getByLabelText('Your name')).toHaveAttribute('autocomplete', 'name')
    await expect(canvas.getByLabelText('Password')).toHaveAttribute('autocomplete', 'new-password')
    await expect(canvas.getByLabelText('Password')).toHaveAccessibleDescription(
      'At least 8 characters.',
    )
    await expect(submitButton(canvas)).toBeEnabled()
  },
})

export const SetsPasswordAndSignsIn = meta.story({
  async play({ canvas }) {
    await setPassword(canvas)
    await userEvent.click(submitButton(canvas))
    await waitFor(() => expect(getRouter().replace).toHaveBeenCalledWith('/'))
  },
})

export const MissingFields = meta.story({
  async play({ canvas }) {
    await userEvent.click(submitButton(canvas))
    await expect(canvas.getByLabelText('Your name')).toHaveAccessibleDescription('Enter your name.')
    await expect(canvas.getByLabelText('Password')).toHaveAccessibleDescription(
      'At least 8 characters. Enter a password.',
    )
    await expect(canvas.getByLabelText('Password')).toBeInvalid()
    await expect(canvas.getByLabelText('Your name')).toHaveFocus()
  },
})

export const PasswordTooShort = meta.story({
  async play({ canvas }) {
    await setPassword(canvas, { password: 'short' })
    await userEvent.click(submitButton(canvas))
    await expect(canvas.getByLabelText('Password')).toHaveAccessibleDescription(
      'At least 8 characters. Use at least 8 characters.',
    )
    await expect(canvas.getByLabelText('Password')).toHaveFocus()
    await expect(getRouter().replace).not.toHaveBeenCalled()
  },
})

export const Pending = meta.story({
  beforeEach({ msw }) {
    msw.use(
      http.post(`${apiUrl}${acceptInviteEndpoint.path}`, async () => {
        await delay('infinite')
      }),
    )
  },
  async play({ canvas }) {
    await setPassword(canvas)
    await userEvent.click(submitButton(canvas))
    await expect(await canvas.findByRole('button', { name: 'Setting password…' })).toBeDisabled()
  },
})

function unusable(token: string, title: string, text: RegExp) {
  return meta.story({
    args: { token },
    async play({ canvas }) {
      await setPassword(canvas)
      await userEvent.click(submitButton(canvas))

      const heading = await canvas.findByRole('heading', { level: 1, name: title })

      await waitFor(() => expect(heading).toHaveFocus())
      await expect(canvas.getByText(text)).toBeVisible()
      await expect(canvas.getByRole('link', { name: 'Go to sign in' })).toHaveAttribute(
        'href',
        '/login',
      )
      await expect(canvas.queryByLabelText('Password')).toBeNull()
    },
  })
}

export const Revoked = unusable('revoked', 'This invite was revoked', /Ask the Operator/)

export const Expired = unusable('expired', 'This invite has expired', /valid for 7 days/)

export const AlreadyUsed = unusable(
  'used',
  'This invite was already used',
  /Sign in with your email address/,
)

export const UnknownLink = unusable(
  'unknown',
  'This invite link does not work',
  /copied the whole link/,
)

export const ExistingAccountWrongPassword = meta.story({
  args: { token: 'existing-account' },
  async play({ canvas }) {
    await setPassword(canvas, { password: 'not-the-password' })
    await userEvent.click(submitButton(canvas))
    await expect(await canvas.findByRole('alert')).toHaveTextContent(
      'An account with this email address already exists. Enter its current password to join the Workspace.',
    )
    await expect(getRouter().replace).not.toHaveBeenCalled()
  },
})

export const ExistingAccountJoins = meta.story({
  args: { token: 'existing-account' },
  async play({ canvas }) {
    await setPassword(canvas, { password: mockCredentials.sandboxAdmin.password })
    await userEvent.click(submitButton(canvas))
    await waitFor(() => expect(getRouter().replace).toHaveBeenCalledWith('/'))
  },
})

export const ServerError = meta.story({
  beforeEach({ msw }) {
    msw.use(
      http.post(`${apiUrl}${acceptInviteEndpoint.path}`, () =>
        HttpResponse.json({ message: 'Internal Server Error' }, { status: 500 }),
      ),
    )
  },
  async play({ canvas }) {
    await setPassword(canvas)
    await userEvent.click(submitButton(canvas))
    await expect(await canvas.findByRole('alert')).toHaveTextContent(
      'The password could not be set. Try again in a moment.',
    )
  },
})

export const SignInFailsAfterPasswordSet = meta.story({
  beforeEach({ msw }) {
    msw.use(
      http.post(`${apiUrl}${signInEndpoint.path}`, () =>
        HttpResponse.json({ message: 'Service Unavailable' }, { status: 503 }),
      ),
    )
  },
  async play({ canvas }) {
    await setPassword(canvas)
    await userEvent.click(submitButton(canvas))

    const heading = await canvas.findByRole('heading', { level: 1, name: 'Your password is set' })

    await waitFor(() => expect(heading).toHaveFocus())
    await expect(canvas.getByText(new RegExp(invitedEmail))).toBeVisible()
    await expect(canvas.getByRole('link', { name: 'Go to sign in' })).toHaveAttribute(
      'href',
      '/login',
    )
  },
})

export const Narrow = meta.story({
  ...mobile,
  async play({ canvas }) {
    await expect(canvas.getByRole('heading', { level: 1, name: 'Set your password' })).toBeVisible()
    await expect(submitButton(canvas)).toBeVisible()
  },
})

export const German = meta.story({
  decorators: [german],
  async play({ canvas }) {
    await expect(
      canvas.getByRole('heading', { level: 1, name: 'Passwort festlegen' }),
    ).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Passwort festlegen und anmelden' }))
    await expect(canvas.getByLabelText('Ihr Name')).toHaveAccessibleDescription(
      'Geben Sie Ihren Namen ein.',
    )
  },
})

export const GermanExpired = meta.story({
  args: { token: 'expired' },
  decorators: [german],
  async play({ canvas }) {
    await userEvent.type(canvas.getByLabelText('Ihr Name'), 'Jonas Weber')
    await userEvent.type(canvas.getByLabelText('Passwort'), 'jonas-password')
    await userEvent.click(canvas.getByRole('button', { name: 'Passwort festlegen und anmelden' }))
    await expect(
      await canvas.findByRole('heading', { level: 1, name: 'Diese Einladung ist abgelaufen' }),
    ).toBeVisible()
    await expect(canvas.getByRole('link', { name: 'Zur Anmeldung' })).toBeVisible()
  },
})

export const Dark = meta.story({
  beforeEach: darkMode,
  async play({ canvas }) {
    await userEvent.click(submitButton(canvas))
    await expect(canvas.getByText('Enter your name.')).toBeVisible()
  },
})

export const DarkExistingAccount = meta.story({
  args: { token: 'existing-account' },
  beforeEach: darkMode,
  async play({ canvas }) {
    await setPassword(canvas, { password: 'not-the-password' })
    await userEvent.click(submitButton(canvas))
    await expect(await canvas.findByRole('alert')).toBeVisible()
  },
})

export const DarkRevoked = meta.story({
  args: { token: 'revoked' },
  beforeEach: darkMode,
  async play({ canvas }) {
    await setPassword(canvas)
    await userEvent.click(submitButton(canvas))
    await expect(
      await canvas.findByRole('heading', { level: 1, name: 'This invite was revoked' }),
    ).toBeVisible()
  },
})
