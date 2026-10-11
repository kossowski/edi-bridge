import { getRouter } from '@storybook/nextjs-vite/navigation.mock'
import { delay, http, HttpResponse } from 'msw'
import { NextIntlClientProvider } from 'next-intl'
import { expect, userEvent, waitFor } from 'storybook/test'

import { LoginScreen } from '@/components/session/login-screen'
import { apiUrl } from '@/lib/api/config'
import messagesDe from '@/messages/de.json'
import { showcaseSignInEndpoint, signInEndpoint } from '@edi-bridge/contracts'
import { createSessionStore, mockCredentials, sessionHandlers } from '@edi-bridge/mocks'

import preview from '../../.storybook/preview'

const meta = preview.meta({
  title: 'Session/LoginScreen',
  component: LoginScreen,
  parameters: { layout: 'centered' },
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
    await expect(canvas.getByRole('heading', { name: 'Sign in to EDI Bridge' })).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'View live demo' })).toBeEnabled()
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

export const MissingFields = meta.story({
  async play({ canvas }) {
    await userEvent.click(canvas.getByRole('button', { name: 'Sign in' }))
    await expect(canvas.getByText('Enter your email address.')).toBeVisible()
    await expect(canvas.getByText('Enter your password.')).toBeVisible()
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
    await expect(canvas.getByRole('button', { name: 'View live demo' })).toBeDisabled()
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

export const LiveDemo = meta.story({
  async play({ canvas }) {
    await userEvent.click(canvas.getByRole('button', { name: 'View live demo' }))
    await waitFor(() => expect(getRouter().replace).toHaveBeenCalledWith('/'))
  },
})

export const LiveDemoError = meta.story({
  beforeEach({ msw }) {
    msw.use(
      http.post(`${apiUrl}${showcaseSignInEndpoint.path}`, () =>
        HttpResponse.json({ message: 'Service Unavailable' }, { status: 503 }),
      ),
    )
  },
  async play({ canvas }) {
    await userEvent.click(canvas.getByRole('button', { name: 'View live demo' }))
    await expect(await canvas.findByRole('alert')).toHaveTextContent(
      'The live demo could not be opened.',
    )
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
    await expect(canvas.getByRole('heading', { name: 'Bei EDI Bridge anmelden' })).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Live-Demo ansehen' })).toBeVisible()
  },
})

export const Dark = meta.story({
  beforeEach() {
    document.documentElement.classList.add('dark')

    return () => document.documentElement.classList.remove('dark')
  },
  async play({ canvas }) {
    await userEvent.click(canvas.getByRole('button', { name: 'Sign in' }))
    await expect(canvas.getByText('Enter your email address.')).toBeVisible()
  },
})
