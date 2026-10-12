import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import type { StoryContext } from '@storybook/nextjs-vite'

import { darkMode, expectNoPageScroll, german, mobile } from '@/components/story-helpers'
import { PartnerWizard } from '@/components/trading-partners/partner-wizard'

import preview from '../../.storybook/preview'

type Canvas = StoryContext['canvas']

const partner = 'Kieler Kontor GmbH'

const inboundGroup = `${partner} sends you purchase orders`

const outboundGroup = `You send dispatch advices and invoices to ${partner}`

const documentNames = {
  ORDERS: /Receive purchase orders/,
  DESADV: /Send dispatch advices/,
  INVOIC: /Send invoices/,
}

async function toConnections(
  canvas: Canvas,
  documents: ReadonlyArray<keyof typeof documentNames>,
  { glnLater = false } = {},
) {
  await userEvent.type(canvas.getByLabelText('Company name'), partner)

  if (glnLater) {
    await userEvent.click(canvas.getByRole('checkbox', { name: "I'll add it later" }))
  } else {
    await userEvent.type(canvas.getByLabelText('Location number (GLN)'), '0234567890129')
  }

  await userEvent.click(canvas.getByRole('button', { name: 'Continue' }))

  for (const document of documents) {
    await userEvent.click(await canvas.findByRole('checkbox', { name: documentNames[document] }))
  }

  await userEvent.click(canvas.getByRole('button', { name: 'Continue' }))
  await waitFor(() =>
    expect(
      canvas.getByRole('heading', { level: 2, name: 'How do documents travel?' }),
    ).toHaveFocus(),
  )
}

function textValue(element: HTMLElement) {
  return element instanceof HTMLTextAreaElement ? element.value : ''
}

function group(canvas: Canvas, name: string) {
  return within(canvas.getByRole('radiogroup', { name }))
}

async function expectMappingsStep(canvas: Canvas) {
  await userEvent.click(canvas.getByRole('button', { name: 'Continue' }))
  await waitFor(() =>
    expect(
      canvas.getByRole('heading', { level: 2, name: 'Which mapping does each document use?' }),
    ).toHaveFocus(),
  )
}

const writeText = fn<(text: string) => Promise<void>>(() => Promise.resolve())

function stubClipboard() {
  writeText.mockClear()
  const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })

  return () => {
    if (original) {
      Object.defineProperty(navigator, 'clipboard', original)
    } else {
      Reflect.deleteProperty(navigator, 'clipboard')
    }
  }
}

const meta = preview.meta({
  title: 'Trading Partners/PartnerWizard/Connections',
  component: PartnerWizard,
  parameters: { layout: 'fullscreen' },
})

export const InboundOnly = meta.story({
  async play({ canvas }) {
    await toConnections(canvas, ['ORDERS'])
    const inbound = group(canvas, inboundGroup)
    await expect(inbound.getAllByRole('radio')).toHaveLength(3)
    await expect(inbound.getByText('Recommended')).toBeVisible()
    await expect(canvas.queryAllByRole('radiogroup')).toHaveLength(1)
    await expect(canvas.queryByRole('textbox')).not.toBeInTheDocument()
  },
})

export const OutboundOnly = meta.story({
  async play({ canvas }) {
    await toConnections(canvas, ['DESADV', 'INVOIC'])
    await expect(group(canvas, outboundGroup).getAllByRole('radio')).toHaveLength(3)
    await expect(canvas.queryAllByRole('radiogroup')).toHaveLength(1)
  },
})

export const BothDirections = meta.story({
  async play({ canvas }) {
    await toConnections(canvas, ['ORDERS', 'DESADV', 'INVOIC'])
    await expect(canvas.getAllByRole('radiogroup')).toHaveLength(2)
    await expect(canvas.getByRole('radiogroup', { name: inboundGroup })).toBeVisible()
    await expect(canvas.getByRole('radiogroup', { name: outboundGroup })).toBeVisible()
  },
})

export const InboundSftp = meta.story({
  async play({ canvas }) {
    await toConnections(canvas, ['ORDERS'])
    await userEvent.click(group(canvas, inboundGroup).getByRole('radio', { name: /SFTP folder/ }))
    const sftp = within(canvas.getByRole('group', { name: 'SFTP connection' }))
    await userEvent.type(sftp.getByLabelText('Host'), 'sftp.kieler-kontor.de')
    await userEvent.type(sftp.getByLabelText('Username'), 'edi')
    await userEvent.clear(sftp.getByLabelText('Folder'))
    await userEvent.type(sftp.getByLabelText('Folder'), '/orders')
    await userEvent.type(sftp.getByLabelText('Password'), 'secret')
    await expect(sftp.getByLabelText('Polling interval (minutes)')).toHaveValue(1)
    await expectMappingsStep(canvas)
  },
})

export const InboundWebAddress = meta.story({
  async play({ canvas }) {
    await toConnections(canvas, ['ORDERS'])
    await userEvent.click(
      group(canvas, inboundGroup).getByRole('radio', { name: /web address of EDI Bridge/ }),
    )
    await expect(
      canvas.getByText(
        `EDI Bridge creates the web address and a key when you finish. You then pass both on to ${partner}.`,
      ),
    ).toBeVisible()
    await expect(canvas.queryByRole('textbox')).not.toBeInTheDocument()
    await expectMappingsStep(canvas)
  },
})

export const OutboundWebAddress = meta.story({
  async play({ canvas }) {
    await toConnections(canvas, ['INVOIC'])
    await userEvent.click(
      canvas.getByRole('radio', { name: new RegExp(`web address of the partner`) }),
    )
    const http = within(canvas.getByRole('group', { name: 'HTTP delivery' }))
    await expect(
      http.getByRole('checkbox', { name: 'Send an Authorization header' }),
    ).not.toBeChecked()
    await userEvent.type(http.getByLabelText('URL'), 'https://edi.kieler-kontor.de/inbox')
    await userEvent.click(http.getByRole('checkbox', { name: 'Send an Authorization header' }))
    await userEvent.type(http.getByLabelText('Authorization header value'), 'Bearer abc123')
    await expectMappingsStep(canvas)
  },
})

export const ValidationErrors = meta.story({
  async play({ canvas }) {
    await toConnections(canvas, ['ORDERS', 'INVOIC'])
    await userEvent.click(canvas.getByRole('button', { name: 'Continue' }))
    const inbound = canvas.getByRole('radiogroup', { name: inboundGroup })
    await expect(inbound).toHaveAccessibleDescription('Choose how the documents travel.')
    await expect(within(inbound).getAllByRole('radio')[0]).toHaveFocus()
    await expect(
      canvas.getByRole('radiogroup', { name: `You send invoices to ${partner}` }),
    ).toHaveAccessibleDescription('Choose how the documents travel.')

    await userEvent.click(within(inbound).getByRole('radio', { name: /SFTP folder/ }))
    await userEvent.click(canvas.getByRole('radio', { name: /web address of the partner/ }))
    await userEvent.type(canvas.getByLabelText('URL'), 'ftp://kieler')
    await userEvent.click(canvas.getByRole('button', { name: 'Continue' }))
    await expect(canvas.getByLabelText('Host')).toHaveFocus()
    await expect(canvas.getByLabelText('Host')).toHaveAccessibleDescription(
      'The host name of the SFTP server, without protocol or port. Enter a host.',
    )
    await expect(canvas.getByText('Enter the password or private key.')).toBeVisible()
    await expect(
      canvas.getByText('Enter a full URL that starts with https:// or http://.'),
    ).toBeVisible()
  },
})

export const Postponed = meta.story({
  beforeEach: stubClipboard,
  async play({ canvas }) {
    await toConnections(canvas, ['ORDERS', 'DESADV', 'INVOIC'], { glnLater: true })
    await userEvent.click(
      group(canvas, inboundGroup).getByRole('radio', { name: /ask the partner/ }),
    )
    await userEvent.click(
      group(canvas, outboundGroup).getByRole('radio', { name: /ask the partner/ }),
    )

    const request = canvas.getByRole('textbox', { name: `Request for ${partner}` })
    await expect(textValue(request)).toContain('For the purchase orders you send us')
    await expect(textValue(request)).toContain('For the dispatch advices and invoices we send you')
    await expect(textValue(request)).toContain('Your location number (GLN).')

    await userEvent.click(canvas.getByRole('button', { name: 'Copy request' }))
    await expect(writeText).toHaveBeenCalledWith(expect.stringContaining('Hello,'))
    await expect(await canvas.findByText('Copied')).toBeVisible()
    await expectMappingsStep(canvas)
  },
})

export const GlnLaterOnly = meta.story({
  async play({ canvas }) {
    await toConnections(canvas, ['INVOIC'], { glnLater: true })
    const request = canvas.getByRole('textbox', { name: `Request for ${partner}` })
    await expect(textValue(request)).toContain('Your location number (GLN).')
    await expect(textValue(request)).not.toContain('invoices')
  },
})

export const StaleDirectionIgnored = meta.story({
  async play({ canvas }) {
    await toConnections(canvas, ['ORDERS', 'INVOIC'])
    await userEvent.click(
      group(canvas, inboundGroup).getByRole('radio', { name: /ask the partner/ }),
    )
    await expect(canvas.getByRole('textbox', { name: `Request for ${partner}` })).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Back' }))
    await userEvent.click(await canvas.findByRole('checkbox', { name: documentNames.ORDERS }))
    await userEvent.click(canvas.getByRole('button', { name: 'Continue' }))
    await expect(
      await canvas.findByRole('radiogroup', { name: `You send invoices to ${partner}` }),
    ).toBeVisible()
    await expect(canvas.queryByRole('textbox')).not.toBeInTheDocument()
  },
})

export const German = meta.story({
  decorators: [german],
  async play({ canvas }) {
    await userEvent.type(canvas.getByLabelText('Firmenname'), partner)
    await userEvent.click(canvas.getByRole('checkbox', { name: 'Ich trage sie später ein' }))
    await userEvent.click(canvas.getByRole('button', { name: 'Weiter' }))
    await userEvent.click(await canvas.findByRole('checkbox', { name: /Bestellungen empfangen/ }))
    await userEvent.click(canvas.getByRole('checkbox', { name: /Rechnungen senden/ }))
    await userEvent.click(canvas.getByRole('button', { name: 'Weiter' }))

    const inbound = within(
      await canvas.findByRole('radiogroup', { name: `${partner} sendet Ihnen Bestellungen` }),
    )

    await userEvent.click(inbound.getByRole('radio', { name: /Wir fragen den Partner/ }))
    await expect(
      textValue(canvas.getByRole('textbox', { name: `Anfrage an ${partner}` })),
    ).toContain('Für die Bestellungen, die Sie uns senden')
    await expect(canvas.getByRole('button', { name: 'Anfrage kopieren' })).toBeVisible()

    await userEvent.click(canvas.getByRole('button', { name: 'Weiter' }))
    await expect(
      canvas.getByRole('radiogroup', { name: `Sie senden Rechnungen an ${partner}` }),
    ).toHaveAccessibleDescription('Wählen Sie, wie die Belege ans Ziel kommen.')
  },
})

export const Dark = meta.story({
  beforeEach: darkMode,
  async play({ canvas }) {
    await toConnections(canvas, ['ORDERS', 'INVOIC'], { glnLater: true })
    await userEvent.click(group(canvas, inboundGroup).getByRole('radio', { name: /SFTP folder/ }))
    await userEvent.click(canvas.getByRole('button', { name: 'Continue' }))
    await expect(canvas.getByText('Enter a host.')).toBeVisible()
  },
})

export const Mobile = meta.story({
  ...mobile,
  async play({ canvas, canvasElement }) {
    await toConnections(canvas, ['ORDERS', 'INVOIC'], { glnLater: true })
    await userEvent.click(group(canvas, inboundGroup).getByRole('radio', { name: /SFTP folder/ }))
    await expect(canvas.getByRole('textbox', { name: `Request for ${partner}` })).toBeVisible()
    await expectNoPageScroll(canvasElement)
  },
})
