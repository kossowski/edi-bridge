import { getRouter } from '@storybook/nextjs-vite/navigation.mock'
import { delay, http, HttpResponse } from 'msw'
import { expect, userEvent, waitFor } from 'storybook/test'

import type { MswApi } from 'msw-storybook-addon'

import { HomeDraftPromo } from '@/components/home/home-draft-promo'
import { viewerStory } from '@/components/session/session-story-helpers'
import { darkMode, expectNoPageScroll, german, mobile } from '@/components/story-helpers'
import { apiUrl } from '@/lib/api/config'
import { createMappingEndpoint, mappingDraftEndpoint } from '@edi-bridge/contracts'
import { mappingHandlers } from '@edi-bridge/mocks'

import preview from '../../.storybook/preview'

const meta = preview.meta({
  title: 'Home/HomeDraftPromo',
  component: HomeDraftPromo,
  parameters: { nextjs: { navigation: { pathname: '/' } } },
  beforeEach({ msw }) {
    msw.use(...mappingHandlers(apiUrl))
  },
})

const createUrl = `${apiUrl}${createMappingEndpoint.path}`

const button = 'Draft a mapping with AI'

function recordCreates(msw: MswApi) {
  const bodies: unknown[] = []

  msw.use(
    http.post(createUrl, async ({ request }) => {
      bodies.push(await request.clone().json())
    }),
  )

  return bodies
}

async function expectOneDraftStart(bodies: unknown[]) {
  await waitFor(() =>
    expect(getRouter().push).toHaveBeenCalledWith(
      expect.stringMatching(/^\/mappings\/[\w-]+\?ai-draft=start$/),
    ),
  )
  await expect(bodies).toEqual([{ messageType: 'ORDERS' }])
  await expect(getRouter().push).toHaveBeenCalledOnce()
}

export const Default = meta.story({
  async play({ canvas, msw }) {
    const createBodies = recordCreates(msw)

    await expect(
      await canvas.findByRole('heading', { name: 'Let the AI draft your next mapping' }),
    ).toBeVisible()

    await userEvent.click(canvas.getByRole('button', { name: button }))

    await expectOneDraftStart(createBodies)

    const href: unknown = getRouter().push.mock.lastCall?.[0]
    const id = new URL(String(href), window.location.origin).pathname.split('/').at(-1) ?? ''
    const draft = await fetch(`${apiUrl}${mappingDraftEndpoint.path.replace(':id', id)}`)

    await expect(draft.status).toBe(200)
  },
})

export const Pending = meta.story({
  beforeEach({ msw }) {
    msw.use(http.post(createUrl, () => delay('infinite')))
  },
  async play({ canvas }) {
    await userEvent.click(await canvas.findByRole('button', { name: button }))

    const creating = canvas.getByRole('button', { name: 'Creating the Mapping…' })

    await expect(creating).toHaveAttribute('aria-disabled', 'true')
    await expect(creating).toHaveFocus()
    await expect(canvas.getByRole('status')).toHaveTextContent('Creating the Mapping…')
  },
})

export const Failed = meta.story({
  beforeEach({ msw }) {
    msw.use(http.post(createUrl, () => HttpResponse.json({ message: 'Down' }, { status: 500 })))
  },
  async play({ canvas }) {
    await userEvent.click(await canvas.findByRole('button', { name: button }))

    await expect(await canvas.findByRole('alert')).toHaveTextContent(
      'The Mapping could not be created. Try again.',
    )
    await expect(canvas.getByRole('button', { name: button })).not.toHaveAttribute('aria-disabled')
    await expect(canvas.getByRole('button', { name: button })).toHaveFocus()
  },
})

export const NoDataFormat = meta.story({
  beforeEach({ msw }) {
    msw.use(
      http.post(createUrl, () =>
        HttpResponse.json(
          { message: 'The Workspace has no Document Structure to map yet.' },
          { status: 422 },
        ),
      ),
    )
  },
  async play({ canvas }) {
    await userEvent.click(await canvas.findByRole('button', { name: button }))

    await expect(await canvas.findByRole('alert')).toHaveTextContent(
      'Add your data format first, so the AI knows the shape of your files.',
    )
    await expect(canvas.getByRole('link', { name: 'Add a data format' })).toHaveAttribute(
      'href',
      '/document-structures/new',
    )
    await expect(canvas.getByRole('button', { name: button })).not.toHaveAttribute('aria-disabled')
  },
})

export const DoubleClick = meta.story({
  async play({ canvas, msw }) {
    const createBodies = recordCreates(msw)

    await userEvent.dblClick(await canvas.findByRole('button', { name: button }))

    await expectOneDraftStart(createBodies)
  },
})

export const RepeatedKeyPresses = meta.story({
  async play({ canvas, msw }) {
    const createBodies = recordCreates(msw)

    const draft = await canvas.findByRole('button', { name: button })

    draft.focus()
    await userEvent.keyboard('{Enter}{Enter}[Space]')

    await expectOneDraftStart(createBodies)
  },
})

export const Viewer = meta.story({
  ...viewerStory({
    async play({ canvas }) {
      await expect(canvas.queryByRole('button', { name: button })).toBeNull()
      await expect(canvas.queryByRole('heading', { name: /draft your next mapping/ })).toBeNull()
    },
  }),
})

export const German = meta.story({
  decorators: [german],
  async play({ canvas }) {
    await expect(
      await canvas.findByRole('heading', {
        name: 'Lassen Sie die KI Ihr nächstes Mapping entwerfen',
      }),
    ).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Mapping mit KI entwerfen' })).toBeEnabled()
  },
})

export const Dark = meta.story({
  beforeEach: () => darkMode(),
  async play({ canvas }) {
    await expect(await canvas.findByRole('button', { name: button })).toBeVisible()
  },
})

export const Mobile = meta.story({
  ...mobile,
  async play({ canvas, canvasElement }) {
    await expect(await canvas.findByRole('button', { name: button })).toBeVisible()
    await expectNoPageScroll(canvasElement)
  },
})
