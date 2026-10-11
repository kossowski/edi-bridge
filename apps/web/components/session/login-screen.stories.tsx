import { getRouter } from '@storybook/nextjs-vite/navigation.mock'
import { delay, http, HttpResponse } from 'msw'
import { expect, userEvent, waitFor } from 'storybook/test'

import { LoginScreen } from '@/components/session/login-screen'
import { darkMode, german, mobile } from '@/components/story-helpers'
import { apiUrl } from '@/lib/api/config'
import { showcaseSignInEndpoint, signInEndpoint } from '@edi-bridge/contracts'
import { createSessionStore, mockCredentials, sessionHandlers } from '@edi-bridge/mocks'

import preview from '../../.storybook/preview'

const meta = preview.meta({
  title: 'Session/LoginScreen',
  component: LoginScreen,
  parameters: { layout: 'padded' },
  beforeEach({ msw }) {
    msw.use(...sessionHandlers(apiUrl, createSessionStore(null)))
  },
})

async function fillIn(
  canvas: { getByLabelText: (label: string) => HTMLElement },
  email: string,
  password: string,
) {
  await userEvent.type(canvas.getByLabelText('Email'), email)
  await userEvent.type(canvas.getByLabelText('Password'), password)
}

export const Default = meta.story({
  async play({ canvas }) {
    await expect(canvas.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible()
    await expect(canvas.getByRole('heading', { name: 'Try the demo' })).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Open the demo' })).toBeEnabled()
    await expect(canvas.getAllByRole('listitem')).toHaveLength(3)
    await expect(canvas.getByText('No account? Ask the Operator for an invite.')).toBeVisible()
    await expect(canvas.queryByRole('link')).toBeNull()
  },
})

export const SignsIn = meta.story({
  async play({ canvas }) {
    await fillIn(canvas, mockCredentials.operator.email, mockCredentials.operator.password)
    await userEvent.click(canvas.getByRole('button', { name: 'Sign in' }))
    await waitFor(() => expect(getRouter().replace).toHaveBeenCalledWith('/'))
  },
})

export const ShowsAndHidesPassword = meta.story({
  async play({ canvas }) {
    const password = canvas.getByLabelText('Password')

    await userEvent.type(password, 'secret')
    await expect(password).toHaveAttribute('type', 'password')

    await userEvent.click(canvas.getByRole('button', { name: 'Show password' }))
    await expect(password).toHaveAttribute('type', 'text')

    await userEvent.click(canvas.getByRole('button', { name: 'Hide password' }))
    await expect(password).toHaveAttribute('type', 'password')
    await expect(password).toHaveValue('secret')
  },
})

export const MissingFields = meta.story({
  async play({ canvas }) {
    await userEvent.click(canvas.getByRole('button', { name: 'Sign in' }))
    await expect(canvas.getByLabelText('Email')).toHaveAccessibleDescription(
      'Enter your email address.',
    )
    await expect(canvas.getByLabelText('Password')).toHaveAccessibleDescription(
      'Enter your password.',
    )
    await expect(canvas.getByLabelText('Password')).toBeInvalid()
    await expect(canvas.getByLabelText('Email')).toHaveFocus()
  },
})

export const WrongCredentials = meta.story({
  async play({ canvas }) {
    await fillIn(canvas, mockCredentials.operator.email, 'not-the-password')
    await userEvent.click(canvas.getByRole('button', { name: 'Sign in' }))
    await expect(await canvas.findByRole('alert')).toHaveTextContent(
      'The email address or password is wrong.',
    )
  },
})

export const Pending = meta.story({
  beforeEach({ msw }) {
    msw.use(
      http.post(`${apiUrl}${signInEndpoint.path}`, async () => {
        await delay('infinite')
      }),
    )
  },
  async play({ canvas }) {
    await fillIn(canvas, mockCredentials.operator.email, mockCredentials.operator.password)
    await userEvent.click(canvas.getByRole('button', { name: 'Sign in' }))
    await expect(await canvas.findByRole('button', { name: 'Signing in…' })).toBeDisabled()
    await expect(canvas.getByRole('button', { name: 'Open the demo' })).toBeDisabled()
  },
})

export const ServerError = meta.story({
  beforeEach({ msw }) {
    msw.use(
      http.post(`${apiUrl}${signInEndpoint.path}`, () =>
        HttpResponse.json({ message: 'Internal Server Error' }, { status: 500 }),
      ),
    )
  },
  async play({ canvas }) {
    await fillIn(canvas, mockCredentials.operator.email, mockCredentials.operator.password)
    await userEvent.click(canvas.getByRole('button', { name: 'Sign in' }))
    await expect(await canvas.findByRole('alert')).toHaveTextContent(
      'Sign-in failed. Try again in a moment.',
    )
  },
})

export const Showcase = meta.story({
  async play({ canvas }) {
    await userEvent.click(canvas.getByRole('button', { name: 'Open the demo' }))
    await waitFor(() => expect(getRouter().replace).toHaveBeenCalledWith('/'))
  },
})

export const ShowcasePending = meta.story({
  beforeEach({ msw }) {
    msw.use(
      http.post(`${apiUrl}${showcaseSignInEndpoint.path}`, async () => {
        await delay('infinite')
      }),
    )
  },
  async play({ canvas }) {
    await userEvent.click(canvas.getByRole('button', { name: 'Open the demo' }))
    await expect(await canvas.findByRole('button', { name: 'Opening the demo…' })).toBeDisabled()
    await expect(canvas.getByRole('button', { name: 'Sign in' })).toBeDisabled()
  },
})

export const ShowcaseError = meta.story({
  beforeEach({ msw }) {
    msw.use(
      http.post(`${apiUrl}${showcaseSignInEndpoint.path}`, () =>
        HttpResponse.json({ message: 'Service Unavailable' }, { status: 503 }),
      ),
    )
  },
  async play({ canvas }) {
    await userEvent.click(canvas.getByRole('button', { name: 'Open the demo' }))
    await expect(await canvas.findByRole('alert')).toHaveTextContent(
      'The demo could not be opened.',
    )
  },
})

export const Narrow = meta.story({
  ...mobile,
  async play({ canvas }) {
    const signIn = canvas.getByRole('heading', { level: 1, name: 'Sign in' })
    const valueStatement = canvas.getByRole('heading', { name: /^Exchange purchase orders/ })

    await expect(signIn.getBoundingClientRect().top).toBeLessThan(
      valueStatement.getBoundingClientRect().top,
    )
  },
})

export const German = meta.story({
  decorators: [german],
  async play({ canvas }) {
    await expect(canvas.getByRole('heading', { level: 1, name: 'Anmelden' })).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Demo öffnen' })).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Passwort anzeigen' })).toBeVisible()
  },
})

export const Dark = meta.story({
  beforeEach: darkMode,
  async play({ canvas }) {
    await userEvent.click(canvas.getByRole('button', { name: 'Sign in' }))
    await expect(canvas.getByText('Enter your email address.')).toBeVisible()
  },
})
