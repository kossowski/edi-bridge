import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import type { StoryContext } from '@storybook/nextjs-vite'

import { darkMode, german, mobile } from '@/components/story-helpers'
import { PartnerWizard } from '@/components/trading-partners/partner-wizard'

import preview from '../../.storybook/preview'

type Canvas = StoryContext['canvas']

async function fillPartner(canvas: Canvas, gln = '0234567890129') {
  await userEvent.type(canvas.getByLabelText('Company name'), 'Kieler Kontor GmbH')
  await userEvent.type(canvas.getByLabelText('Location number (GLN)'), gln)
}

async function continueTo(canvas: Canvas, heading: string) {
  await userEvent.click(canvas.getByRole('button', { name: 'Continue' }))
  await waitFor(() =>
    expect(canvas.getByRole('heading', { level: 2, name: heading })).toHaveFocus(),
  )
}

async function toDocuments(canvas: Canvas) {
  await fillPartner(canvas)
  await continueTo(canvas, 'Which documents do you exchange?')
}

function progressSteps(canvas: Canvas) {
  return within(canvas.getByRole('list', { name: 'Progress' })).getAllByRole('listitem')
}

function currentStep(canvas: Canvas) {
  return progressSteps(canvas).find((item) => item.getAttribute('aria-current') === 'step')
}

const meta = preview.meta({
  title: 'Trading Partners/PartnerWizard',
  component: PartnerWizard,
  args: { onFinish: fn() },
  parameters: { layout: 'fullscreen' },
})

export const Partner = meta.story({
  async play({ canvas }) {
    await expect(
      canvas.getByRole('heading', { level: 1, name: 'Add a trading partner' }),
    ).toBeInTheDocument()
    await expect(
      canvas.getByRole('heading', { level: 2, name: 'Who is the partner?' }),
    ).toBeVisible()
    await expect(currentStep(canvas)).toHaveTextContent('Partner')
    await expect(canvas.getByText('Step 1 of 5')).toBeVisible()
    await expect(canvas.getByRole('link', { name: 'Cancel' })).toHaveAttribute(
      'href',
      '/trading-partners',
    )
  },
})

export const PartnerErrors = meta.story({
  async play({ canvas }) {
    await userEvent.click(canvas.getByRole('button', { name: 'Continue' }))
    await expect(canvas.getByLabelText('Company name')).toHaveFocus()
    await expect(canvas.getByText('Enter the company name.')).toBeVisible()
    await expect(canvas.getByText("Enter the GLN, or choose “I'll add it later”.")).toBeVisible()

    await userEvent.type(canvas.getByLabelText('Company name'), 'Kieler Kontor GmbH')
    await userEvent.type(canvas.getByLabelText('Location number (GLN)'), '0234567890128')
    await userEvent.click(canvas.getByRole('button', { name: 'Continue' }))
    await expect(canvas.getByLabelText('Location number (GLN)')).toHaveFocus()
    await expect(
      canvas.getByText('The check digit does not match. Check the GLN for typos.'),
    ).toBeVisible()
  },
})

export const GlnLater = meta.story({
  async play({ canvas }) {
    await fillPartner(canvas, '123')
    await userEvent.click(canvas.getByRole('checkbox', { name: "I'll add it later" }))
    await expect(canvas.getByLabelText('Location number (GLN)')).toBeDisabled()
    await continueTo(canvas, 'Which documents do you exchange?')
  },
})

export const Documents = meta.story({
  async play({ canvas }) {
    await toDocuments(canvas)
    await expect(currentStep(canvas)).toHaveTextContent('Documents')
    await expect(progressSteps(canvas)[0]).toHaveTextContent('Partner, done')

    const group = within(canvas.getByRole('group', { name: 'Which documents do you exchange?' }))
    await expect(group.getAllByRole('checkbox')).toHaveLength(3)
    await expect(
      group.getByText("Your invoices reach the partner's accounting without email or paper."),
    ).toBeVisible()
  },
})

export const DocumentsError = meta.story({
  async play({ canvas }) {
    await toDocuments(canvas)
    await userEvent.click(canvas.getByRole('button', { name: 'Continue' }))
    await expect(canvas.getByText('Choose at least one document.')).toBeVisible()
    await expect(canvas.getAllByRole('checkbox')[0]).toHaveFocus()
  },
})

export const BackKeepsValues = meta.story({
  async play({ canvas }) {
    await toDocuments(canvas)
    await userEvent.click(canvas.getByRole('checkbox', { name: /Send invoices/ }))
    await continueTo(canvas, 'How do documents travel?')
    await userEvent.click(canvas.getByRole('button', { name: 'Back' }))
    await expect(canvas.getByRole('checkbox', { name: /Send invoices/ })).toBeChecked()
    await userEvent.click(canvas.getByRole('button', { name: 'Back' }))
    await expect(canvas.getByLabelText('Company name')).toHaveValue('Kieler Kontor GmbH')
    await expect(canvas.getByLabelText('Location number (GLN)')).toHaveValue('0234567890129')
  },
})

export const Review = meta.story({
  async play({ args, canvas }) {
    await toDocuments(canvas)
    await userEvent.click(canvas.getByRole('checkbox', { name: /Receive purchase orders/ }))
    await continueTo(canvas, 'How do documents travel?')
    await continueTo(canvas, 'Which mapping does each document use?')
    await continueTo(canvas, 'Review and create')
    await userEvent.click(canvas.getByRole('button', { name: 'Create partner in Test Mode' }))
    await expect(args.onFinish).toHaveBeenCalledWith(
      expect.objectContaining({
        partner: { name: 'Kieler Kontor GmbH', gln: '0234567890129', glnLater: false },
        documents: ['ORDERS'],
      }),
    )
  },
})

export const German = meta.story({
  decorators: [german],
  async play({ canvas }) {
    await expect(
      canvas.getByRole('heading', { level: 2, name: 'Wer ist der Partner?' }),
    ).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Weiter' }))
    await expect(canvas.getByText('Geben Sie den Firmennamen ein.')).toBeVisible()
  },
})

export const GermanDocuments = meta.story({
  decorators: [german],
  async play({ canvas }) {
    await userEvent.type(canvas.getByLabelText('Firmenname'), 'Kieler Kontor GmbH')
    await userEvent.click(canvas.getByRole('checkbox', { name: 'Ich trage sie später ein' }))
    await userEvent.click(canvas.getByRole('button', { name: 'Weiter' }))
    await expect(await canvas.findByRole('checkbox', { name: /Lieferavise senden/ })).toBeVisible()
  },
})

export const Dark = meta.story({
  beforeEach: darkMode,
  async play({ canvas }) {
    await userEvent.click(canvas.getByRole('button', { name: 'Continue' }))
    await expect(canvas.getByText('Enter the company name.')).toBeVisible()
  },
})

export const DarkDocuments = meta.story({
  beforeEach: darkMode,
  async play({ canvas }) {
    await toDocuments(canvas)
    await userEvent.click(canvas.getByRole('checkbox', { name: /Send dispatch advices/ }))
    await userEvent.click(canvas.getByRole('checkbox', { name: /Send invoices/ }))
    await expect(canvas.getByRole('checkbox', { name: /Send invoices/ })).toBeChecked()
  },
})

export const Mobile = meta.story({
  ...mobile,
  async play({ canvas }) {
    await expect(
      canvas.getByRole('heading', { level: 2, name: 'Who is the partner?' }),
    ).toBeVisible()
    await expect(currentStep(canvas)).toHaveTextContent('Partner')
  },
})
