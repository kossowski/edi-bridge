import { expect, screen, userEvent, waitFor, within } from 'storybook/test'

import type { StoryContext } from '@storybook/nextjs-vite'

import { type WizardDocument } from '@/components/trading-partners/partner-wizard-state'
import { type Direction } from '@edi-bridge/contracts'

type Canvas = StoryContext['canvas']

export const wizardPartner = 'Kieler Kontor GmbH'

const documentChoices = {
  ORDERS: /Receive purchase orders/,
  DESADV: /Send dispatch advices/,
  INVOIC: /Send invoices/,
} satisfies Record<WizardDocument, RegExp>

const documentNames = {
  ORDERS: 'purchase orders',
  DESADV: 'dispatch advices',
  INVOIC: 'invoices',
} satisfies Record<WizardDocument, string>

const webWays = {
  inbound: /web address of EDI Bridge/,
  outbound: /web address of the partner/,
} satisfies Record<Direction, RegExp>

export async function continueTo(canvas: Canvas, heading: string) {
  await userEvent.click(canvas.getByRole('button', { name: 'Continue' }))
  await waitFor(() =>
    expect(canvas.getByRole('heading', { level: 2, name: heading })).toHaveFocus(),
  )
}

export async function toMappings(
  canvas: Canvas,
  documents: ReadonlyArray<WizardDocument>,
  {
    glnLater = false,
    ways = {},
  }: { glnLater?: boolean; ways?: Partial<Record<Direction, 'ask' | 'web'>> } = {},
) {
  await userEvent.type(canvas.getByLabelText('Company name'), wizardPartner)

  if (glnLater) {
    await userEvent.click(canvas.getByRole('checkbox', { name: "I'll add it later" }))
  } else {
    await userEvent.type(canvas.getByLabelText('Location number (GLN)'), '0234567890129')
  }

  await continueTo(canvas, 'Which documents do you exchange?')

  for (const document of documents) {
    await userEvent.click(canvas.getByRole('checkbox', { name: documentChoices[document] }))
  }

  await continueTo(canvas, 'How do documents travel?')

  for (const radiogroup of canvas.getAllByRole('radiogroup')) {
    const group = within(radiogroup)
    const direction = group.queryByRole('radio', { name: webWays.inbound }) ? 'inbound' : 'outbound'

    if ((ways[direction] ?? 'web') === 'ask') {
      await userEvent.click(group.getByRole('radio', { name: /ask the partner/ }))
    } else {
      await userEvent.click(group.getByRole('radio', { name: webWays[direction] }))
    }
  }

  if (ways.outbound !== 'ask' && canvas.queryByLabelText('URL')) {
    await userEvent.type(canvas.getByLabelText('URL'), 'https://edi.kieler-kontor.de/inbox')
  }

  await continueTo(canvas, 'Which mapping does each document use?')
}

export async function findMappingGroup(canvas: Canvas, document: WizardDocument) {
  return within(
    await canvas.findByRole('radiogroup', { name: `Mapping for ${documentNames[document]}` }),
  )
}

export function mappingSelect(canvas: Canvas, document: WizardDocument) {
  return canvas.getByRole('combobox', {
    name: `Which mapping translates ${documentNames[document]}?`,
  })
}

export async function chooseMapping(canvas: Canvas, document: WizardDocument, mapping: string) {
  const group = await findMappingGroup(canvas, document)
  await userEvent.click(group.getByRole('radio', { name: /existing mapping/ }))
  await userEvent.click(mappingSelect(canvas, document))
  const option = await screen.findByRole('option', { name: new RegExp(`^${mapping}`) })
  await closeSelectPopup(() => userEvent.click(option))
}

export async function closeSelectPopup(close: () => Promise<void>) {
  const popup = screen.getByRole('listbox').closest('[data-base-ui-portal]')
  await expect(popup).toBeInTheDocument()
  await close()
  // The closed popup keeps its focus guards until the next frame, which Chromium throttles in a
  // hidden iframe, and axe fails a story that ends before then with aria-hidden-focus.
  await waitFor(() => expect(popup?.querySelector('[data-base-ui-focus-guard]')).toBeNull())
}
