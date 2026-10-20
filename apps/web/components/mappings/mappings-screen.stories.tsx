import { getRouter } from '@storybook/nextjs-vite/navigation.mock'
import { delay, http, HttpResponse } from 'msw'
import { expect, screen, userEvent, waitFor, within } from 'storybook/test'

import { MappingsScreen } from '@/components/mappings/mappings-screen'
import { viewerStory } from '@/components/session/session-story-helpers'
import { darkMode, german, mobile } from '@/components/story-helpers'
import { apiUrl } from '@/lib/api/config'
import { createMappingEndpoint } from '@edi-bridge/contracts'
import {
  createDocumentStructures,
  createHandlers,
  createMappingsWithTraffic,
  documentStructureHandlers,
  mappingHandlers,
  seedDocumentStructures,
  seedMappings,
} from '@edi-bridge/mocks'

import preview from '../../.storybook/preview'

const meta = preview.meta({
  title: 'Mappings/MappingsScreen',
  component: MappingsScreen,
  parameters: { layout: 'fullscreen', nextjs: { navigation: { pathname: '/mappings' } } },
  beforeEach({ msw }) {
    msw.use(...createHandlers(apiUrl))
  },
})

async function lane(canvasElement: HTMLElement, name: string) {
  return within(await within(canvasElement).findByRole('region', { name }))
}

function card(link: HTMLElement) {
  // SAFETY: every card title link sits inside the card's list item.
  return within(link.closest('li') as HTMLElement)
}

async function badges(canvasElement: HTMLElement, name: string) {
  const region = await within(canvasElement).findByRole('region', { name })

  return Array.from(
    region.querySelectorAll('li [data-slot="badge"]'),
    (badge) => badge.textContent ?? '',
  )
}

async function openNewMappingSheet(canvasElement: HTMLElement, name = 'New Mapping') {
  await userEvent.click(await within(canvasElement).findByRole('button', { name }))

  return within(await screen.findByRole('dialog', { name }))
}

// SAFETY: the seed holds a Document Structure for every Message Type.
const documentStructure = seedDocumentStructures[0]!

async function chooseDocumentStructure(
  sheet: Awaited<ReturnType<typeof openNewMappingSheet>>,
  name = documentStructure.name,
) {
  await userEvent.selectOptions(
    await sheet.findByRole('combobox', { name: 'Your data format' }),
    name,
  )
}

const choices = ['Purchase orders you receive', 'Dispatch advices you send', 'Invoices you send']

const createUrl = `${apiUrl}${createMappingEndpoint.path}`

// SAFETY: the seed holds one Mapping under this name, the one shared by two partners.
const sharedMappingId = seedMappings.find(
  ({ versions }) => versions[0]?.mappingName === 'ERP JSON to DESADV',
)!.mappingId

const stateOrder = ['Documents failed', 'Draft not published', 'Never published', 'Running fine']

export const Default = meta.story({
  async play({ canvasElement }) {
    const comingIn = await lane(canvasElement, 'Coming in')
    const goingOut = await lane(canvasElement, 'Going out')

    await expect(comingIn.getByText('Trading partner')).toBeVisible()

    const shared = card(
      await goingOut.findByRole('link', { name: 'Dispatch advices to 2 partners' }),
    )

    await expect(shared.getByText('Documents failed')).toBeVisible()
    await expect(shared.getByText(/failed in the last 7 days$/)).toBeVisible()
    await expect(
      shared.getByText('Bodensee Handelshaus AG and Spreewald Frische GmbH'),
    ).toBeVisible()
    const documentStructure = shared.getByText('ERP dispatch advice')

    await expect(documentStructure).toBeVisible()
    await expect(documentStructure).toHaveTextContent('Your data format: ERP dispatch advice')
    const seeWhatFailed = shared.getByRole('link', { name: 'See what failed' })

    await expect(seeWhatFailed).toBeVisible()
    await expect(seeWhatFailed).toHaveAttribute(
      'href',
      `/documents?status=attention&mapping=${sharedMappingId}`,
    )

    const neverPublished = card(goingOut.getByRole('link', { name: 'Invoices' }))

    await expect(neverPublished.getAllByText('Never published')).toHaveLength(2)
    await expect(neverPublished.getByText('Nothing is translated yet')).toBeVisible()
    await expect(neverPublished.getByText('No trading partner yet')).toBeVisible()
    await expect(neverPublished.getByRole('link', { name: 'Draft with AI' })).toHaveAttribute(
      'href',
      expect.stringMatching(/^\/mappings\/[\w-]+\?ai-draft=start$/),
    )

    const draft = card(
      comingIn.getByRole('link', { name: 'Receipt confirmations from Spreewald Frische GmbH' }),
    )

    await expect(draft.getByText('Draft not published')).toBeVisible()
    await expect(draft.getByText('Changes not published')).toBeVisible()
    await expect(draft.getByRole('link', { name: 'Review and publish' })).toBeVisible()
    await expect(draft.getByText(/^Version 3 live since/)).toBeVisible()

    const live = card(
      comingIn.getByRole('link', { name: 'Purchase orders from Bodensee Handelshaus AG' }),
    )

    await expect(live.getByText('Running fine')).toBeVisible()
    await expect(live.getByText(/(translated|No documents) in the last 7 days$/)).toBeVisible()
    await expect(live.getByRole('link', { name: 'Open' })).toBeVisible()
  },
})

export const NeedsAttention = meta.story({
  beforeEach({ msw }) {
    msw.use(...mappingHandlers(apiUrl, createMappingsWithTraffic({ count: 16 })))
  },
  async play({ canvas, canvasElement }) {
    const needsYou = await canvas.findByRole('button', { name: /Needs you/ })

    const shown = [
      ...(await badges(canvasElement, 'Coming in')),
      ...(await badges(canvasElement, 'Going out')),
    ]

    await expect(new Set(shown)).toEqual(new Set(stateOrder))

    for (const name of ['Coming in', 'Going out']) {
      const ranks = (await badges(canvasElement, name)).map((badge) => stateOrder.indexOf(badge))

      await expect(ranks).toEqual(ranks.toSorted((left: number, right: number) => left - right))
    }

    await userEvent.click(needsYou)

    await expect(needsYou).toHaveAttribute('aria-pressed', 'true')

    for (const name of ['Coming in', 'Going out']) {
      for (const badge of await badges(canvasElement, name)) {
        await expect(['Documents failed', 'Draft not published']).toContain(badge)
      }
    }
  },
})

export const Loading = meta.story({
  beforeEach({ msw }) {
    msw.use(...mappingHandlers(apiUrl, { mappings: 'loading' }))
  },
  async play({ canvas }) {
    await expect(canvas.getByRole('status')).toHaveTextContent('Loading Mappings')
  },
})

export const Unavailable = meta.story({
  beforeEach({ msw }) {
    msw.use(...mappingHandlers(apiUrl, { mappings: 'error' }))
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('Mappings unavailable')).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Try again' })).toBeVisible()
  },
})

export const LargeVolume = meta.story({
  beforeEach({ msw }) {
    msw.use(...mappingHandlers(apiUrl, createMappingsWithTraffic({ count: 300 })))
  },
  async play({ canvas, canvasElement }) {
    await expect(await canvas.findByRole('button', { name: /All\s*300/ })).toBeVisible()

    const comingIn = await lane(canvasElement, 'Coming in')

    await expect(comingIn.getAllByRole('listitem')).toHaveLength(20)

    await userEvent.click(comingIn.getByRole('button', { name: /^Show all \d+$/ }))

    await expect(comingIn.getAllByRole('listitem').length).toBeGreaterThan(20)
  },
})

export const NewMappingSheet = meta.story({
  async play({ canvasElement }) {
    const sheet = await openNewMappingSheet(canvasElement)

    await expect(sheet.getAllByRole('button', { name: /you (receive|send)$/ })).toHaveLength(3)

    for (const name of choices) {
      await expect(sheet.getByRole('button', { name })).toBeEnabled()
    }

    await expect(sheet.getAllByText('Draft with AI')).toHaveLength(3)
    await expect(
      sheet.getByRole('button', { name: 'Purchase orders you receive' }),
    ).toHaveAccessibleDescription('Trading partner goes into Your ERP')

    const picker = await sheet.findByRole('combobox', { name: 'Your data format' })

    await expect(picker).toHaveValue('')

    await userEvent.click(sheet.getByRole('button', { name: 'Invoices you send' }))

    await expect(picker).toHaveFocus()
    await expect(picker).toHaveAccessibleDescription(/^Choose your data format first\./)
    await expect(getRouter().push).not.toHaveBeenCalled()

    await chooseDocumentStructure(sheet)
    await userEvent.click(sheet.getByRole('button', { name: 'Invoices you send' }))

    await waitFor(() =>
      expect(getRouter().push).toHaveBeenCalledWith(
        expect.stringMatching(/^\/mappings\/[\w-]+\?ai-draft=start$/),
      ),
    )
  },
})

export const NewMappingFromLane = meta.story({
  async play({ canvasElement }) {
    const goingOut = await lane(canvasElement, 'Going out')

    await userEvent.click(
      await goingOut.findByRole('button', { name: 'Another document going out' }),
    )

    const sheet = within(await screen.findByRole('dialog', { name: 'New Mapping' }))

    await waitFor(() =>
      expect(sheet.getByRole('button', { name: 'Dispatch advices you send' })).toBeVisible(),
    )
    await expect(sheet.getByRole('button', { name: 'Invoices you send' })).toBeVisible()
    await expect(sheet.queryByRole('button', { name: 'Purchase orders you receive' })).toBeNull()
  },
})

export const NewMappingWithMessageType = meta.story({
  args: { newMessageType: 'DESADV' },
  async play({ msw }) {
    const bodies: unknown[] = []

    msw.use(
      http.post(createUrl, async ({ request }) => {
        bodies.push(await request.clone().json())
      }),
    )

    const sheet = within(await screen.findByRole('dialog', { name: 'New Mapping' }))

    await waitFor(() =>
      expect(sheet.getByRole('button', { name: 'Dispatch advices you send' })).toBeVisible(),
    )
    await expect(sheet.getAllByRole('button', { name: /you (receive|send)$/ })).toHaveLength(1)

    await chooseDocumentStructure(sheet)
    await userEvent.click(sheet.getByRole('button', { name: 'Dispatch advices you send' }))

    await waitFor(() =>
      expect(getRouter().push).toHaveBeenCalledWith(
        expect.stringMatching(/^\/mappings\/[\w-]+\?ai-draft=start$/),
      ),
    )
    await expect(bodies).toEqual([
      { messageType: 'DESADV', documentStructureId: documentStructure.id },
    ])
  },
})

export const NewMappingWithMessageTypeClosed = meta.story({
  args: { newMessageType: 'DESADV' },
  async play({ canvasElement }) {
    await screen.findByRole('dialog', { name: 'New Mapping' })
    await userEvent.keyboard('{Escape}')

    await waitFor(() =>
      expect(getRouter().replace).toHaveBeenCalledWith('/mappings', { scroll: false }),
    )

    const sheet = await openNewMappingSheet(canvasElement)

    await waitFor(() =>
      expect(sheet.getAllByRole('button', { name: /you (receive|send)$/ })).toHaveLength(3),
    )
  },
})

export const CreatingMapping = meta.story({
  beforeEach({ msw }) {
    msw.use(http.post(createUrl, () => delay('infinite')))
  },
  async play({ canvasElement }) {
    const sheet = await openNewMappingSheet(canvasElement)

    await chooseDocumentStructure(sheet)
    await userEvent.click(sheet.getByRole('button', { name: 'Dispatch advices you send' }))

    await expect(await sheet.findByRole('status')).toHaveTextContent('Creating the Mapping…')

    await expect(sheet.getByRole('button', { name: 'Dispatch advices you send' })).toHaveFocus()

    for (const name of choices) {
      await expect(sheet.getByRole('button', { name })).toHaveAttribute('aria-disabled', 'true')
    }
  },
})

export const CreateMappingOnce = meta.story({
  async play({ canvasElement, msw }) {
    const bodies: unknown[] = []

    msw.use(
      http.post(createUrl, async ({ request }) => {
        bodies.push(await request.clone().json())
      }),
    )

    const sheet = await openNewMappingSheet(canvasElement)

    await chooseDocumentStructure(sheet)
    await userEvent.dblClick(sheet.getByRole('button', { name: 'Invoices you send' }))
    await userEvent.click(sheet.getByRole('button', { name: 'Dispatch advices you send' }))

    await waitFor(() =>
      expect(getRouter().push).toHaveBeenCalledWith(
        expect.stringMatching(/^\/mappings\/[\w-]+\?ai-draft=start$/),
      ),
    )
    await expect(bodies).toEqual([
      { messageType: 'INVOIC', documentStructureId: documentStructure.id },
    ])
    await expect(getRouter().push).toHaveBeenCalledOnce()
  },
})

export const CreateMappingFailed = meta.story({
  beforeEach({ msw }) {
    msw.use(
      http.post(createUrl, () =>
        HttpResponse.json({ message: 'The Document Structure does not exist.' }, { status: 422 }),
      ),
    )
  },
  async play({ canvasElement }) {
    const sheet = await openNewMappingSheet(canvasElement)

    await chooseDocumentStructure(sheet)
    await userEvent.click(sheet.getByRole('button', { name: 'Purchase orders you receive' }))

    await expect(await sheet.findByRole('alert')).toHaveTextContent(
      'This data format no longer exists. Choose another one.',
    )
    await expect(sheet.getByRole('button', { name: 'Purchase orders you receive' })).toBeEnabled()
  },
})

export const CreateMappingUnavailable = meta.story({
  beforeEach({ msw }) {
    msw.use(http.post(createUrl, () => HttpResponse.json({ message: 'Down' }, { status: 500 })))
  },
  async play({ canvasElement }) {
    const sheet = await openNewMappingSheet(canvasElement)

    await chooseDocumentStructure(sheet)
    await userEvent.click(sheet.getByRole('button', { name: 'Invoices you send' }))

    await expect(await sheet.findByRole('alert')).toHaveTextContent(
      'The Mapping could not be created. Try again.',
    )
  },
})

export const OneDocumentStructure = meta.story({
  beforeEach({ msw }) {
    msw.use(...documentStructureHandlers(apiUrl, { documentStructures: [documentStructure] }))
  },
  async play({ canvasElement, msw }) {
    const bodies: unknown[] = []

    msw.use(
      http.post(createUrl, async ({ request }) => {
        bodies.push(await request.clone().json())
      }),
    )

    const sheet = await openNewMappingSheet(canvasElement)

    await waitFor(() =>
      expect(sheet.getByRole('combobox', { name: 'Your data format' })).toHaveDisplayValue(
        documentStructure.name,
      ),
    )

    await userEvent.click(sheet.getByRole('button', { name: 'Purchase orders you receive' }))

    await waitFor(() => expect(getRouter().push).toHaveBeenCalledOnce())
    await expect(bodies).toEqual([
      { messageType: 'ORDERS', documentStructureId: documentStructure.id },
    ])
  },
})

export const NoDocumentStructure = meta.story({
  beforeEach({ msw }) {
    msw.use(...documentStructureHandlers(apiUrl, { documentStructures: [] }))
  },
  async play({ canvasElement }) {
    const sheet = await openNewMappingSheet(canvasElement)

    await expect(
      await sheet.findByText(
        'Add your data format first, so the AI knows the shape of your files.',
      ),
    ).toBeVisible()
    await expect(sheet.getByRole('link', { name: 'Add a data format' })).toHaveAttribute(
      'href',
      '/data-formats/new',
    )
    await expect(sheet.queryByRole('combobox')).toBeNull()
    await expect(sheet.queryByRole('button', { name: 'Invoices you send' })).toBeNull()
  },
})

export const DocumentStructuresLoading = meta.story({
  beforeEach({ msw }) {
    msw.use(...documentStructureHandlers(apiUrl, { state: 'loading' }))
  },
  async play({ canvasElement }) {
    const sheet = await openNewMappingSheet(canvasElement)

    await expect(await sheet.findByRole('status')).toHaveTextContent('Loading your data formats')

    for (const name of choices) {
      await expect(sheet.getByRole('button', { name })).toHaveAttribute('aria-disabled', 'true')
    }
  },
})

export const DocumentStructuresUnavailable = meta.story({
  beforeEach({ msw }) {
    msw.use(...documentStructureHandlers(apiUrl, { state: 'error' }))
  },
  async play({ canvasElement }) {
    const sheet = await openNewMappingSheet(canvasElement)

    await expect(await sheet.findByRole('alert')).toHaveTextContent(
      'Your data formats could not be loaded.',
    )
    await waitFor(() => expect(sheet.getByRole('button', { name: 'Try again' })).toBeVisible())
    await expect(sheet.queryByRole('button', { name: 'Invoices you send' })).toBeNull()
  },
})

const manyDocumentStructures = [
  ...seedDocumentStructures,
  ...createDocumentStructures({ count: 40 }),
]

export const ManyDocumentStructures = meta.story({
  beforeEach({ msw }) {
    msw.use(...createHandlers(apiUrl, { documentStructures: manyDocumentStructures }))
  },
  async play({ canvasElement, msw }) {
    const bodies: unknown[] = []
    // SAFETY: the story adds 40 Document Structures to the seed.
    const last = manyDocumentStructures.at(-1)!

    msw.use(
      http.post(createUrl, async ({ request }) => {
        bodies.push(await request.clone().json())
      }),
    )

    const sheet = await openNewMappingSheet(canvasElement)
    const picker = await sheet.findByRole('combobox', { name: 'Your data format' })

    await waitFor(() =>
      expect(within(picker).getAllByRole('option')).toHaveLength(manyDocumentStructures.length + 1),
    )
    await expect(picker).toHaveValue('')

    await chooseDocumentStructure(sheet, last.name)
    await userEvent.click(sheet.getByRole('button', { name: 'Invoices you send' }))

    await waitFor(() => expect(getRouter().push).toHaveBeenCalledOnce())
    await expect(bodies).toEqual([{ messageType: 'INVOIC', documentStructureId: last.id }])
  },
})

export const NoDocumentStructureGerman = meta.story({
  decorators: [german],
  beforeEach({ msw }) {
    msw.use(...documentStructureHandlers(apiUrl, { documentStructures: [] }))
  },
  async play({ canvasElement }) {
    const sheet = await openNewMappingSheet(canvasElement, 'Neues Mapping')

    await expect(
      await sheet.findByText(
        'Legen Sie zuerst Ihr Datenformat an, damit die KI die Form Ihrer Dateien kennt.',
      ),
    ).toBeVisible()
    await expect(sheet.getByRole('link', { name: 'Datenformat anlegen' })).toHaveAttribute(
      'href',
      '/data-formats/new',
    )
  },
})

export const DocumentStructuresLoadingGerman = meta.story({
  decorators: [german],
  beforeEach({ msw }) {
    msw.use(...documentStructureHandlers(apiUrl, { state: 'loading' }))
  },
  async play({ canvasElement }) {
    const sheet = await openNewMappingSheet(canvasElement, 'Neues Mapping')

    await expect(await sheet.findByRole('status')).toHaveTextContent(
      'Ihre Datenformate werden geladen',
    )
  },
})

export const DocumentStructuresUnavailableGerman = meta.story({
  decorators: [german],
  beforeEach({ msw }) {
    msw.use(...documentStructureHandlers(apiUrl, { state: 'error' }))
  },
  async play({ canvasElement }) {
    const sheet = await openNewMappingSheet(canvasElement, 'Neues Mapping')

    await expect(await sheet.findByRole('alert')).toHaveTextContent(
      'Ihre Datenformate konnten nicht geladen werden.',
    )
    await waitFor(() =>
      expect(sheet.getByRole('button', { name: 'Erneut versuchen' })).toBeVisible(),
    )
  },
})

export const EmptyWorkspace = meta.story({
  beforeEach({ msw }) {
    msw.use(...mappingHandlers(apiUrl, { mappings: [] }))
  },
  async play({ canvas }) {
    await expect(
      await canvas.findByRole('heading', { name: 'Translate your first document' }),
    ).toBeVisible()
    await expect(
      canvas.getByText(
        'The AI drafts the Mapping from an example document, and you check every link.',
      ),
    ).toBeVisible()

    for (const name of choices) {
      await expect(canvas.getByRole('button', { name })).toBeVisible()
    }

    await expect(canvas.queryByRole('group', { name: 'Show' })).toBeNull()
    await expect(canvas.queryByRole('region', { name: 'Coming in' })).toBeNull()
  },
})

export const EmptyWorkspaceDocumentStructureMissing = meta.story({
  beforeEach({ msw }) {
    msw.use(...mappingHandlers(apiUrl, { mappings: [] }))
  },
  async play({ canvas }) {
    await canvas.findByRole('combobox', { name: 'Your data format' })
    await userEvent.click(canvas.getByRole('button', { name: 'Invoices you send' }))

    const error = await canvas.findByText('Choose your data format first.')

    await expect(canvas.getByRole('combobox', { name: 'Your data format' })).toHaveFocus()
    await expect(getComputedStyle(error).textAlign).toBe('left')
    await expect(getRouter().push).not.toHaveBeenCalled()
  },
})

export const EmptyWorkspaceWithoutDocumentStructure = meta.story({
  beforeEach({ msw }) {
    msw.use(
      ...mappingHandlers(apiUrl, { mappings: [], documentStructures: [] }),
      ...documentStructureHandlers(apiUrl, { documentStructures: [] }),
    )
  },
  async play({ canvas }) {
    await expect(
      await canvas.findByText(
        'Add your data format first, so the AI knows the shape of your files.',
      ),
    ).toBeVisible()
    await expect(canvas.getByRole('link', { name: 'Add a data format' })).toBeVisible()
  },
})

export const EmptyWorkspaceGerman = meta.story({
  decorators: [german],
  beforeEach({ msw }) {
    msw.use(...mappingHandlers(apiUrl, { mappings: [] }))
  },
  async play({ canvas }) {
    await expect(
      await canvas.findByRole('heading', { name: 'Übersetzen Sie Ihren ersten Beleg' }),
    ).toBeVisible()

    for (const name of [
      'Bestellungen, die Sie empfangen',
      'Lieferavise, die Sie senden',
      'Rechnungen, die Sie senden',
    ]) {
      await expect(canvas.getByRole('button', { name })).toBeVisible()
    }
  },
})

export const EmptyWorkspaceWithMessageType = meta.story({
  args: { newMessageType: 'INVOIC' },
  beforeEach({ msw }) {
    msw.use(...mappingHandlers(apiUrl, { mappings: [] }))
  },
  async play({ canvas }) {
    await expect(await canvas.findByRole('button', { name: 'Invoices you send' })).toBeVisible()
    await expect(canvas.getAllByRole('button', { name: /you (receive|send)$/ })).toHaveLength(1)
  },
})

export const EmptyWorkspaceDark = meta.story({
  beforeEach({ msw }) {
    msw.use(...mappingHandlers(apiUrl, { mappings: [] }))

    return darkMode()
  },
  async play({ canvas }) {
    await expect(
      await canvas.findByRole('heading', { name: 'Translate your first document' }),
    ).toBeVisible()
  },
})

export const Viewer = meta.story({
  ...viewerStory({
    async play({ canvas, canvasElement }) {
      await lane(canvasElement, 'Going out')
      await canvas.findByRole('link', { name: 'Dispatch advices to 2 partners' })

      await expect(canvas.queryByRole('button', { name: 'New Mapping' })).toBeNull()
      await expect(canvas.queryByRole('button', { name: /^Another document/ })).toBeNull()
    },
  }),
})

export const ViewerWithMessageType = meta.story({
  args: { newMessageType: 'DESADV' },
  ...viewerStory({
    async play({ canvas, canvasElement }) {
      await lane(canvasElement, 'Going out')
      await canvas.findByRole('link', { name: 'Dispatch advices to 2 partners' })

      await expect(screen.queryByRole('dialog', { name: 'New Mapping' })).toBeNull()
    },
  }),
})

export const ViewerEmpty = meta.story({
  ...viewerStory({
    handlers: [...mappingHandlers(apiUrl, { mappings: [] })],
    async play({ canvas }) {
      await expect(
        await canvas.findByText('Mappings appear here once an Admin creates one.'),
      ).toBeVisible()
      await expect(canvas.queryByRole('button', { name: 'Invoices you send' })).toBeNull()
    },
  }),
})

export const German = meta.story({
  decorators: [german],
  async play({ canvasElement }) {
    const comingIn = await lane(canvasElement, 'Eingehend')
    const goingOut = await lane(canvasElement, 'Ausgehend')

    await expect(comingIn.getByText('Handelspartner')).toBeVisible()
    await expect(
      await goingOut.findByRole('link', { name: 'Lieferavise an 2 Partner' }),
    ).toBeVisible()
    await expect(
      comingIn.getByRole('link', { name: 'Bestellungen von Bodensee Handelshaus AG' }),
    ).toBeVisible()
    await expect(goingOut.getByRole('link', { name: 'Mit KI entwerfen' })).toBeVisible()

    await userEvent.click(goingOut.getByRole('button', { name: 'Weiterer ausgehender Beleg' }))

    const sheet = within(await screen.findByRole('dialog', { name: 'Neues Mapping' }))

    await waitFor(() =>
      expect(sheet.getByRole('button', { name: 'Rechnungen, die Sie senden' })).toBeVisible(),
    )
    await expect(await sheet.findByRole('combobox', { name: 'Ihr Datenformat' })).toBeVisible()
  },
})

export const Dark = meta.story({
  beforeEach({ msw }) {
    msw.use(...mappingHandlers(apiUrl, createMappingsWithTraffic({ count: 16 })))

    return darkMode()
  },
  async play({ canvas, canvasElement }) {
    await canvas.findByRole('button', { name: /Needs you/ })

    const shown = [
      ...(await badges(canvasElement, 'Coming in')),
      ...(await badges(canvasElement, 'Going out')),
    ]

    await expect(new Set(shown)).toEqual(new Set(stateOrder))
  },
})

export const NewMappingSheetDark = meta.story({
  beforeEach() {
    return darkMode()
  },
  async play({ canvasElement }) {
    const sheet = await openNewMappingSheet(canvasElement)

    await expect(sheet.getAllByRole('button', { name: /you (receive|send)$/ })).toHaveLength(3)
  },
})

export const Mobile = meta.story({
  ...mobile,
  async play({ canvas }) {
    await expect(
      await canvas.findByRole('link', { name: 'Dispatch advices to 2 partners' }),
    ).toBeVisible()
  },
})
