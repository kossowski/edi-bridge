import { getRouter } from '@storybook/nextjs-vite/navigation.mock'
import { delay, http, HttpResponse } from 'msw'
import { useLayoutEffect, useState } from 'react'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import type { StoryContext } from '@storybook/nextjs-vite'

import { darkMode, expectNoPageScroll, german, mobile } from '@/components/story-helpers'
import { PartnerScreen } from '@/components/trading-partners/partner-screen'
import { withPartnerFrame } from '@/components/trading-partners/partner-story-helpers'
import { PartnerWizard } from '@/components/trading-partners/partner-wizard'
import {
  chooseMapping,
  continueTo,
  findMappingGroup,
  toMappings,
  wizardPartner,
} from '@/components/trading-partners/partner-wizard-story-helpers'
import { apiUrl } from '@/lib/api/config'
import {
  createChannelEndpoint,
  createFlowEndpoint,
  createMappingEndpoint,
  createTradingPartnerEndpoint,
} from '@edi-bridge/contracts'
import {
  createHandlers,
  createTradingPartner,
  documentStructureHandlers,
  seedDocumentStructures,
  seedTradingPartners,
} from '@edi-bridge/mocks'

import preview from '../../.storybook/preview'

type Canvas = StoryContext['canvas']

const finishLabel = 'Create partner for testing'

function WizardThenPartnerPage() {
  const [partnerId, setPartnerId] = useState<string | null>(null)

  useLayoutEffect(() => {
    getRouter().push.mockImplementation((href: string) => {
      setPartnerId(href.replace('/trading-partners/', ''))
    })
  }, [])

  return partnerId ? <PartnerScreen id={partnerId} /> : <PartnerWizard />
}

async function toReviewWithRoutes(canvas: Canvas) {
  await toMappings(canvas, ['ORDERS', 'INVOIC'])
  await chooseMapping(canvas, 'ORDERS', 'Hansemarkt: ORDERS to ERP JSON')
  await chooseMapping(canvas, 'INVOIC', 'Hansemarkt: ERP JSON to INVOIC')
  await continueTo(canvas, 'Review and create')
  await canvas.findByRole('region', { name: 'Document routes' })
}

async function toReviewWithAiDrafts(canvas: Canvas) {
  await toMappings(canvas, ['ORDERS', 'DESADV'])

  for (const document of ['ORDERS', 'DESADV'] as const) {
    const group = await findMappingGroup(canvas, document)
    await userEvent.click(group.getByRole('radio', { name: /Let AI draft one/ }))
  }

  await continueTo(canvas, 'Review and create')
  await canvas.findByRole('region', { name: 'Mappings' })
}

async function findNotice(canvas: Canvas) {
  const title = await canvas.findByRole('heading', {
    level: 2,
    name: `${wizardPartner} is created for testing`,
  })

  await waitFor(() => expect(title).toHaveFocus())

  return within(canvas.getByRole('region', { name: `${wizardPartner} is created for testing` }))
}

const meta = preview.meta({
  title: 'Trading Partners/PartnerWizard/Finish',
  component: WizardThenPartnerPage,
  parameters: { layout: 'fullscreen' },
  decorators: [withPartnerFrame],
  beforeEach({ msw }) {
    msw.use(
      ...documentStructureHandlers(apiUrl, {
        documentStructures: seedDocumentStructures.slice(0, 1),
      }),
      ...createHandlers(apiUrl),
    )
  },
})

function recordMappingCreates(msw: StoryContext['msw']) {
  const bodies: unknown[] = []

  msw.use(
    http.post(`${apiUrl}${createMappingEndpoint.path}`, async ({ request }) => {
      bodies.push(await request.clone().json())
    }),
  )

  return bodies
}

export const Success = meta.story({
  async play({ canvas }) {
    await toReviewWithRoutes(canvas)
    await userEvent.click(canvas.getByRole('button', { name: finishLabel }))

    const notice = await findNotice(canvas)
    await expect(getRouter().push).toHaveBeenCalledWith(
      expect.stringMatching(/^\/trading-partners\/[\da-f-]+$/),
    )
    await expect(notice.getByText(/marked as tests until you go live/)).toBeVisible()
    await expect(
      notice.getByRole('heading', { name: `Web address for ${wizardPartner}` }),
    ).toBeVisible()
    await expect(notice.getByText(/\/webhooks\//)).toBeVisible()
    await expect(
      notice.getByRole('heading', { name: 'Copy the webhook token now' }),
    ).toBeInTheDocument()
    await expect(notice.queryByRole('heading', { name: 'Not created' })).not.toBeInTheDocument()
    await expect(notice.queryByRole('heading', { name: 'AI drafts' })).not.toBeInTheDocument()

    await expect(notice.queryByRole('heading', { name: 'Set up later' })).not.toBeInTheDocument()

    await userEvent.click(notice.getByRole('button', { name: 'Done' }))
    await expect(
      canvas.queryByRole('heading', { name: `${wizardPartner} is created for testing` }),
    ).not.toBeInTheDocument()
    await expect(canvas.getByRole('heading', { level: 1, name: wizardPartner })).toHaveFocus()
    await expect(canvas.getByText('Testing', { exact: true })).toBeVisible()

    await userEvent.click(canvas.getByRole('tab', { name: 'Connections' }))

    const connections = within(
      await canvas.findByRole('list', { name: `Connections with ${wizardPartner}` }),
    )

    for (const connection of [`${wizardPartner} webhook`, `${wizardPartner} HTTP delivery`]) {
      await expect(connections.getByRole('link', { name: connection })).toBeVisible()
    }

    await userEvent.click(canvas.getByRole('tab', { name: 'Documents' }))

    const documents = within(
      await canvas.findByRole('list', { name: `Document types with ${wizardPartner}` }),
    )

    for (const route of [`Purchase orders from ${wizardPartner}`, `Invoices to ${wizardPartner}`]) {
      await expect(documents.getByRole('link', { name: route })).toBeVisible()
    }
  },
})

export const LeftForLater = meta.story({
  async play({ canvas }) {
    await toMappings(canvas, ['ORDERS', 'INVOIC'], { ways: { inbound: 'ask' } })
    await chooseMapping(canvas, 'ORDERS', 'Hansemarkt: ORDERS to ERP JSON')
    const invoices = await findMappingGroup(canvas, 'INVOIC')
    await userEvent.click(invoices.getByRole('radio', { name: /^Later/ }))
    await continueTo(canvas, 'Review and create')
    await canvas.findByRole('region', { name: 'Document routes' })
    await userEvent.click(canvas.getByRole('button', { name: finishLabel }))

    const notice = await findNotice(canvas)
    const later = within(notice.getByRole('region', { name: 'Set up later' }))

    await expect(later.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      `Connection for documents from ${wizardPartner} Add it once ${wizardPartner} sends you the connection details.`,
      `Document route for purchase orders It follows once the connection to ${wizardPartner} is added.`,
      'Document route for invoices Choose the mapping in the setup steps.',
    ])
    await expect(notice.queryByRole('heading', { name: 'Not created' })).not.toBeInTheDocument()
    await expect(
      notice.queryByRole('heading', { name: `Web address for ${wizardPartner}` }),
    ).not.toBeInTheDocument()
  },
})

export const AiDrafts = meta.story({
  async play({ canvas, msw }) {
    const bodies = recordMappingCreates(msw)

    await toReviewWithAiDrafts(canvas)
    await userEvent.click(canvas.getByRole('button', { name: finishLabel }))

    const notice = await findNotice(canvas)
    const drafts = within(notice.getByRole('region', { name: 'AI drafts' }))

    await expect(bodies).toEqual(
      ['ORDERS', 'DESADV'].map((messageType) => ({
        messageType,
        documentStructureId: seedDocumentStructures[0]?.id,
      })),
    )
    await expect(notice.queryByRole('region', { name: 'Mappings to create' })).toBeNull()

    for (const documents of ['purchase orders', 'dispatch advices']) {
      await expect(
        drafts.getByRole('link', { name: `Draft the mapping for ${documents} with AI` }),
      ).toHaveAttribute('href', expect.stringMatching(/^\/mappings\/[\da-f-]+\?ai-draft=start$/))
    }

    await expect(
      notice.getByRole('heading', { name: `Web address for ${wizardPartner}` }),
    ).toBeVisible()
  },
})

export const AiDraftsWithSeveralDocumentStructures = meta.story({
  beforeEach({ msw }) {
    msw.use(...documentStructureHandlers(apiUrl, { documentStructures: seedDocumentStructures }))
  },
  async play({ canvas, msw }) {
    const bodies = recordMappingCreates(msw)

    await toReviewWithAiDrafts(canvas)
    await userEvent.click(canvas.getByRole('button', { name: finishLabel }))

    const notice = await findNotice(canvas)
    const skipped = within(notice.getByRole('region', { name: 'Mappings to create' }))

    await expect(
      skipped.getByText(
        'These mappings were not created because you have several data formats. Create each mapping and choose its data format.',
      ),
    ).toBeVisible()
    await expect(
      skipped.getByRole('link', { name: 'Create the mapping for purchase orders' }),
    ).toHaveAttribute('href', '/mappings?new=ORDERS')
    await expect(
      skipped.getByRole('link', { name: 'Create the mapping for dispatch advices' }),
    ).toHaveAttribute('href', '/mappings?new=DESADV')
    await expect(notice.queryByRole('region', { name: 'AI drafts' })).toBeNull()
    await expect(bodies).toEqual([])
  },
})

export const AiDraftsWithoutDocumentStructure = meta.story({
  beforeEach({ msw }) {
    msw.use(...documentStructureHandlers(apiUrl, { documentStructures: [] }))
  },
  async play({ canvas }) {
    await toReviewWithAiDrafts(canvas)
    await userEvent.click(canvas.getByRole('button', { name: finishLabel }))

    const notice = await findNotice(canvas)
    const skipped = within(notice.getByRole('region', { name: 'Mappings to create' }))

    await expect(
      skipped.getByText(
        'These mappings were not created because you have no data format yet. Add one, then create each mapping.',
      ),
    ).toBeVisible()
    await expect(skipped.getAllByRole('link')).toHaveLength(2)
  },
})

export const Pending = meta.story({
  beforeEach({ msw }) {
    msw.use(
      http.post(`${apiUrl}${createTradingPartnerEndpoint.path}`, async () => {
        await delay('infinite')
      }),
    )
  },
  async play({ canvas }) {
    await toReviewWithRoutes(canvas)
    await userEvent.click(canvas.getByRole('button', { name: finishLabel }))

    const pending = await canvas.findByRole('button', { name: 'Creating the partner…' })
    await expect(pending).toHaveAttribute('aria-disabled', 'true')
    await expect(canvas.getByRole('button', { name: 'Back' })).toBeDisabled()

    await userEvent.click(pending)
    await expect(getRouter().push).not.toHaveBeenCalled()
    await expect(canvas.getByRole('heading', { level: 2, name: 'Review and create' })).toBeVisible()
  },
})

export const CreateFailed = meta.story({
  beforeEach({ msw }) {
    msw.use(
      http.post(`${apiUrl}${createTradingPartnerEndpoint.path}`, () =>
        HttpResponse.json({ message: 'Internal Server Error' }, { status: 500 }),
      ),
    )
  },
  async play({ canvas }) {
    await toReviewWithRoutes(canvas)
    await userEvent.click(canvas.getByRole('button', { name: finishLabel }))

    await expect(await canvas.findByRole('alert')).toHaveTextContent(
      `${wizardPartner} could not be created, so nothing is set up yet. Try again.`,
    )
    await expect(canvas.getByRole('button', { name: finishLabel })).not.toHaveAttribute(
      'aria-disabled',
    )
    await expect(getRouter().push).not.toHaveBeenCalled()
  },
})

export const GlnTaken = meta.story({
  beforeEach({ msw }) {
    msw.use(
      ...createHandlers(apiUrl, {
        tradingPartners: [
          ...seedTradingPartners,
          createTradingPartner({ name: 'Kieler Kontor AG', gln: '0234567890129' }),
        ],
      }),
    )
  },
  async play({ canvas }) {
    await toReviewWithRoutes(canvas)
    await userEvent.click(canvas.getByRole('button', { name: finishLabel }))

    const gln = await canvas.findByLabelText('Location number (GLN)')
    await waitFor(() => expect(gln).toHaveFocus())
    await expect(
      canvas.getByRole('heading', { level: 2, name: 'Who is the partner?' }),
    ).toBeVisible()
    await expect(
      canvas.getByText(
        "Another trading partner already uses this GLN. Check it for typos, or choose “I'll add it later”.",
      ),
    ).toBeVisible()

    await userEvent.click(canvas.getByRole('button', { name: 'Continue' }))
    await expect(gln).toHaveFocus()

    await userEvent.click(canvas.getByRole('checkbox', { name: "I'll add it later" }))
    await continueTo(canvas, 'Which documents do you exchange?')
  },
})

export const PartialFailure = meta.story({
  beforeEach({ msw }) {
    msw.use(
      http.post(`${apiUrl}${createChannelEndpoint.path}`, () =>
        HttpResponse.json({ message: 'Internal Server Error' }, { status: 500 }),
      ),
    )
  },
  async play({ canvas }) {
    await toReviewWithRoutes(canvas)
    await userEvent.click(canvas.getByRole('button', { name: finishLabel }))

    const notice = await findNotice(canvas)
    const left = within(notice.getByRole('region', { name: 'Not created' }))

    await expect(left.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      `Connection ${wizardPartner} webhook`,
      `Connection ${wizardPartner} HTTP delivery`,
      `Document route Purchase orders from ${wizardPartner}`,
      `Document route Invoices to ${wizardPartner}`,
    ])
    await expect(
      notice.queryByRole('heading', { name: `Web address for ${wizardPartner}` }),
    ).not.toBeInTheDocument()
    await expect(await canvas.findByRole('region', { name: 'Setup' })).toBeVisible()
  },
})

export const RouteFailed = meta.story({
  beforeEach({ msw }) {
    msw.use(
      http.post(`${apiUrl}${createFlowEndpoint.path}`, () =>
        HttpResponse.json({ message: 'Internal Server Error' }, { status: 500 }),
      ),
    )
  },
  async play({ canvas }) {
    await toReviewWithRoutes(canvas)
    await userEvent.click(canvas.getByRole('button', { name: finishLabel }))

    const notice = await findNotice(canvas)
    const left = within(notice.getByRole('region', { name: 'Not created' }))

    await expect(left.getAllByRole('listitem')).toHaveLength(2)
    await expect(
      notice.getByRole('heading', { name: `Web address for ${wizardPartner}` }),
    ).toBeVisible()
  },
})

export const German = meta.story({
  decorators: [german],
  async play({ canvas }) {
    await userEvent.type(canvas.getByLabelText('Firmenname'), wizardPartner)
    await userEvent.click(canvas.getByRole('checkbox', { name: 'Ich trage sie später ein' }))
    await userEvent.click(canvas.getByRole('button', { name: 'Weiter' }))
    await userEvent.click(await canvas.findByRole('checkbox', { name: /Rechnungen senden/ }))
    await userEvent.click(canvas.getByRole('button', { name: 'Weiter' }))
    await userEvent.click(await canvas.findByRole('radio', { name: /Wir fragen den Partner/ }))
    await userEvent.click(canvas.getByRole('button', { name: 'Weiter' }))
    await userEvent.click(await canvas.findByRole('radio', { name: /Von der KI entwerfen lassen/ }))
    await userEvent.click(canvas.getByRole('button', { name: 'Weiter' }))
    await canvas.findByRole('region', { name: 'Belegwege' })
    await userEvent.click(canvas.getByRole('button', { name: 'Partner im Testbetrieb anlegen' }))

    const title = await canvas.findByRole('heading', {
      level: 2,
      name: `${wizardPartner} ist im Testbetrieb angelegt`,
    })

    await waitFor(() => expect(title).toHaveFocus())
    await expect(
      canvas.getByRole('link', { name: 'Mapping für Rechnungen mit KI entwerfen' }),
    ).toBeVisible()

    const later = within(canvas.getByRole('region', { name: 'Später einrichten' }))
    await expect(later.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      `Verbindung für Belege an ${wizardPartner} Fügen Sie sie hinzu, sobald ${wizardPartner} Ihnen die Verbindungsangaben schickt.`,
      'Belegweg für Rechnungen Er folgt, sobald die Verbindung zu Kieler Kontor GmbH hinzugefügt ist. Er braucht den veröffentlichten KI-Entwurf.',
    ])
  },
})

export const GermanWithSeveralDocumentStructures = meta.story({
  decorators: [german],
  beforeEach({ msw }) {
    msw.use(...documentStructureHandlers(apiUrl, { documentStructures: seedDocumentStructures }))
  },
  async play({ canvas }) {
    await userEvent.type(canvas.getByLabelText('Firmenname'), wizardPartner)
    await userEvent.click(canvas.getByRole('checkbox', { name: 'Ich trage sie später ein' }))
    await userEvent.click(canvas.getByRole('button', { name: 'Weiter' }))
    await userEvent.click(await canvas.findByRole('checkbox', { name: /Rechnungen senden/ }))
    await userEvent.click(canvas.getByRole('button', { name: 'Weiter' }))
    await userEvent.click(await canvas.findByRole('radio', { name: /Wir fragen den Partner/ }))
    await userEvent.click(canvas.getByRole('button', { name: 'Weiter' }))
    await userEvent.click(await canvas.findByRole('radio', { name: /Von der KI entwerfen lassen/ }))
    await userEvent.click(canvas.getByRole('button', { name: 'Weiter' }))
    await canvas.findByRole('region', { name: 'Belegwege' })
    await userEvent.click(canvas.getByRole('button', { name: 'Partner im Testbetrieb anlegen' }))

    const skipped = within(await canvas.findByRole('region', { name: 'Anzulegende Mappings' }))

    await expect(
      skipped.getByText(
        'Diese Mappings wurden nicht angelegt, weil Sie mehrere Datenformate haben. Legen Sie jedes Mapping an und wählen Sie sein Datenformat.',
      ),
    ).toBeVisible()
    await expect(
      skipped.getByRole('link', { name: 'Mapping für Rechnungen anlegen' }),
    ).toHaveAttribute('href', '/mappings?new=INVOIC')
  },
})

export const Dark = meta.story({
  beforeEach(context) {
    context.msw.use(
      http.post(`${apiUrl}${createFlowEndpoint.path}`, () =>
        HttpResponse.json({ message: 'Internal Server Error' }, { status: 500 }),
      ),
    )

    return darkMode()
  },
  async play({ canvas }) {
    await toReviewWithRoutes(canvas)
    await userEvent.click(canvas.getByRole('button', { name: finishLabel }))

    const notice = await findNotice(canvas)
    await expect(notice.getByRole('region', { name: 'Not created' })).toBeVisible()
  },
})

export const Mobile = meta.story({
  ...mobile,
  async play({ canvas, canvasElement }) {
    await toReviewWithAiDrafts(canvas)
    await userEvent.click(canvas.getByRole('button', { name: finishLabel }))

    const notice = await findNotice(canvas)
    const drafts = notice.getByRole('region', { name: 'AI drafts' })
    await expect(drafts).toBeVisible()

    const { right } = drafts.getBoundingClientRect()

    for (const link of within(drafts).getAllByRole('link')) {
      await expect(link.getBoundingClientRect().right).toBeLessThanOrEqual(right)
    }

    await expectNoPageScroll(canvasElement)
  },
})
