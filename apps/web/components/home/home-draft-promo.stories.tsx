import { getRouter } from '@storybook/nextjs-vite/navigation.mock'
import { delay, http, HttpResponse } from 'msw'
import { expect, userEvent, waitFor } from 'storybook/test'

import type { MswApi } from 'msw-storybook-addon'
import type { screen } from 'storybook/test'

import { HomeDraftPromo } from '@/components/home/home-draft-promo'
import { viewerStory } from '@/components/session/session-story-helpers'
import { darkMode, expectNoPageScroll, german, mobile } from '@/components/story-helpers'
import { apiUrl } from '@/lib/api/config'
import { createMappingEndpoint, mappingDraftEndpoint } from '@edi-bridge/contracts'
import {
  documentStructureHandlers,
  mappingHandlers,
  seedDocumentStructures,
} from '@edi-bridge/mocks'

import preview from '../../.storybook/preview'

// SAFETY: the seed holds a Document Structure for every Message Type.
const documentStructure = seedDocumentStructures[0]!

const meta = preview.meta({
  title: 'Home/HomeDraftPromo',
  component: HomeDraftPromo,
  parameters: { nextjs: { navigation: { pathname: '/' } } },
  beforeEach({ msw }) {
    msw.use(
      ...mappingHandlers(apiUrl),
      ...documentStructureHandlers(apiUrl, { documentStructures: [documentStructure] }),
    )
  },
})

const createUrl = `${apiUrl}${createMappingEndpoint.path}`

const button = 'Draft a mapping with AI'

async function findDraftButton(canvas: { findByRole: typeof screen.findByRole }) {
  const draft = await canvas.findByRole('button', { name: button })

  await waitFor(() => expect(draft).not.toHaveAttribute('aria-disabled'))

  return draft
}

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
  await expect(bodies).toEqual([
    { messageType: 'ORDERS', documentStructureId: documentStructure.id },
  ])
  await expect(getRouter().push).toHaveBeenCalledOnce()
}

export const Default = meta.story({
  async play({ canvas, msw }) {
    const createBodies = recordCreates(msw)

    await expect(
      await canvas.findByRole('heading', { name: 'Let the AI draft your next mapping' }),
    ).toBeVisible()

    await userEvent.click(await findDraftButton(canvas))

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
    await userEvent.click(await findDraftButton(canvas))

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
    await userEvent.click(await findDraftButton(canvas))

    await expect(await canvas.findByRole('alert')).toHaveTextContent(
      'The Mapping could not be created. Try again.',
    )
    await expect(canvas.getByRole('button', { name: button })).not.toHaveAttribute('aria-disabled')
    await expect(canvas.getByRole('button', { name: button })).toHaveFocus()
  },
})

export const DocumentStructureGone = meta.story({
  beforeEach({ msw }) {
    msw.use(
      http.post(createUrl, () =>
        HttpResponse.json({ message: 'The Document Structure does not exist.' }, { status: 422 }),
      ),
    )
  },
  async play({ canvas }) {
    await userEvent.click(await findDraftButton(canvas))

    await expect(await canvas.findByRole('alert')).toHaveTextContent(
      'This data format no longer exists. Choose another one.',
    )
  },
})

async function expectCreateStepLink(
  canvas: { findByRole: typeof screen.findByRole },
  name = button,
) {
  await expect(await canvas.findByRole('link', { name })).toHaveAttribute(
    'href',
    '/mappings?new=ORDERS',
  )
}

export const SeveralDocumentStructures = meta.story({
  beforeEach({ msw }) {
    msw.use(...documentStructureHandlers(apiUrl, { documentStructures: seedDocumentStructures }))
  },
  async play({ canvas, msw }) {
    const createBodies = recordCreates(msw)

    await expectCreateStepLink(canvas)
    await expect(canvas.queryByRole('button', { name: button })).toBeNull()
    await expect(createBodies).toEqual([])
  },
})

export const SeveralDocumentStructuresGerman = meta.story({
  decorators: [german],
  beforeEach({ msw }) {
    msw.use(...documentStructureHandlers(apiUrl, { documentStructures: seedDocumentStructures }))
  },
  async play({ canvas }) {
    await expectCreateStepLink(canvas, 'Mapping mit KI entwerfen')
  },
})

export const NoDocumentStructure = meta.story({
  beforeEach({ msw }) {
    msw.use(...documentStructureHandlers(apiUrl, { documentStructures: [] }))
  },
  async play({ canvas }) {
    await expectCreateStepLink(canvas)
  },
})

export const DocumentStructuresLoading = meta.story({
  beforeEach({ msw }) {
    msw.use(...documentStructureHandlers(apiUrl, { state: 'loading' }))
  },
  async play({ canvas, msw }) {
    const createBodies = recordCreates(msw)
    const draft = await canvas.findByRole('button', { name: button })

    await expect(draft).toHaveAttribute('aria-disabled', 'true')
    await userEvent.click(draft)
    await expect(createBodies).toEqual([])
  },
})

export const DocumentStructuresUnavailable = meta.story({
  beforeEach({ msw }) {
    msw.use(...documentStructureHandlers(apiUrl, { state: 'error' }))
  },
  async play({ canvas }) {
    await expectCreateStepLink(canvas)
  },
})

export const DoubleClick = meta.story({
  async play({ canvas, msw }) {
    const createBodies = recordCreates(msw)

    await userEvent.dblClick(await findDraftButton(canvas))

    await expectOneDraftStart(createBodies)
  },
})

export const RepeatedKeyPresses = meta.story({
  async play({ canvas, msw }) {
    const createBodies = recordCreates(msw)

    const draft = await findDraftButton(canvas)

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
    await expect(canvasElement.querySelector('[data-sketch="narrow"]')).toBeVisible()
    await expect(canvasElement.querySelector('[data-sketch="wide"]')).not.toBeVisible()
    await expectNoPageScroll(canvasElement)
  },
})
