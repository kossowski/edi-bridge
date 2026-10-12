import { getRouter } from '@storybook/nextjs-vite/navigation.mock'
import { delay, http, HttpResponse } from 'msw'
import { expect, screen, userEvent, waitFor, within } from 'storybook/test'

import { NewCodeTranslationScreen } from '@/components/code-translations/new-code-translation-screen'
import { darkMode, expectNoPageScroll, german, mobile } from '@/components/story-helpers'
import { apiUrl } from '@/lib/api/config'
import {
  createLookupTableEndpoint,
  lookupTableKinds,
  lookupTableSuggestionsEndpoint,
} from '@edi-bridge/contracts'
import {
  createTradingPartners,
  lookupTableHandlers,
  seedTradingPartners,
  tradingPartnerHandlers,
} from '@edi-bridge/mocks'

import type { LookupTableKind } from '@edi-bridge/contracts'

import preview from '../../.storybook/preview'

// SAFETY: the seed holds Hansemarkt GmbH first.
const hansemarkt = seedTradingPartners[0] as (typeof seedTradingPartners)[number]

const generatedTradingPartners = createTradingPartners({ count: 300 })

const manyTradingPartners = [...seedTradingPartners, ...generatedTradingPartners]

// SAFETY: 300 Trading Partners were generated.
const lastTradingPartner = generatedTradingPartners.at(
  -1,
) as (typeof generatedTradingPartners)[number]

const kindLabels = {
  units: 'Units of measure',
  countries: 'Countries',
  addresses: 'Store or delivery addresses',
  other: 'Other codes',
} as const satisfies Record<LookupTableKind, string>

function startsWith(text: string) {
  return (name: string) => name.startsWith(text)
}

function suggestionsResponding(respond: () => Promise<Response> | Response) {
  return http.get(`${apiUrl}${lookupTableSuggestionsEndpoint.path}`, respond)
}

async function chooseKindAndEveryPartner(root: HTMLElement, kind: LookupTableKind = 'units') {
  const canvas = within(root)

  await userEvent.click(await canvas.findByRole('radio', { name: startsWith(kindLabels[kind]) }))
  await userEvent.click(await canvas.findByRole('radio', { name: startsWith('Every partner') }))
}

async function suggestionList(root: HTMLElement) {
  return within(await within(root).findByRole('list', { name: /^Suggested values/ }))
}

const meta = preview.meta({
  title: 'Code Translations/NewCodeTranslationScreen',
  component: NewCodeTranslationScreen,
  parameters: {
    layout: 'fullscreen',
    nextjs: { navigation: { pathname: '/code-translations/new' } },
  },
  beforeEach({ msw }) {
    msw.use(...lookupTableHandlers(apiUrl), ...tradingPartnerHandlers(apiUrl))
  },
})

export const Default = meta.story({
  async play({ canvas }) {
    const kinds = within(
      await canvas.findByRole('radiogroup', { name: 'What is written differently?' }),
    )

    await expect(kinds.getAllByRole('radio')).toHaveLength(lookupTableKinds.length)
    await expect(
      kinds.getByRole('radio', { name: startsWith('Units of measure') }),
    ).toHaveAccessibleDescription('Your ST is sent as PCE')
    await expect(canvas.queryByRole('radiogroup', { name: 'Who receives it?' })).toBeNull()
    await expect(canvas.queryByRole('button', { name: 'Create list' })).toBeNull()
  },
})

export const Units = meta.story({
  async play({ canvas, canvasElement }) {
    await chooseKindAndEveryPartner(canvasElement, 'units')
    const suggestions = await suggestionList(canvasElement)

    await expect(await suggestions.findByRole('textbox', { name: 'Send ST as' })).toHaveValue('PCE')
    await expect(suggestions.getByText('PCE means Piece.')).toBeVisible()
    await expect(canvas.getByText(/^Creates/)).toHaveTextContent(
      'Creates Units of measure (2) with no values.',
    )
  },
})

export const Countries = meta.story({
  async play({ canvas, canvasElement }) {
    await chooseKindAndEveryPartner(canvasElement, 'countries')
    const suggestions = await suggestionList(canvasElement)

    await expect(
      await suggestions.findByRole('textbox', { name: 'Send Deutschland as' }),
    ).toHaveValue('DE')
    await expect(canvas.getByText(/^Creates/)).toHaveTextContent(
      'Creates Countries with no values.',
    )
  },
})

export const Addresses = meta.story({
  async play({ canvas, canvasElement }) {
    await chooseKindAndEveryPartner(canvasElement, 'addresses')

    await expect(
      await canvas.findByText('There are no suggestions for this kind. Add your own values below.'),
    ).toBeVisible()
    const add = within(canvas.getByRole('form', { name: 'Add a value' }))

    await expect(add.getByRole('textbox', { name: 'Your value' })).not.toHaveFocus()
    await expect(canvas.getByRole('radio', { name: startsWith('Every partner') })).toHaveFocus()
  },
})

export const Other = meta.story({
  async play({ canvas, canvasElement }) {
    await chooseKindAndEveryPartner(canvasElement, 'other')
    const add = within(await canvas.findByRole('form', { name: 'Add a value' }))

    await userEvent.type(add.getByRole('textbox', { name: 'Your value' }), 'S')
    await userEvent.type(add.getByRole('textbox', { name: 'What the partner gets' }), 'STANDARD')
    await userEvent.click(add.getByRole('button', { name: 'Save' }))

    const values = within(canvas.getByRole('list', { name: /^Values in the new list/ }))

    await expect(values.getByText('STANDARD')).toBeVisible()
    await expect(
      within(canvas.getByRole('form', { name: 'Add a value' })).getByRole('textbox', {
        name: 'Your value',
      }),
    ).toHaveFocus()
  },
})

export const TradingPartnerChosen = meta.story({
  async play({ canvas }) {
    await userEvent.click(
      await canvas.findByRole('radio', { name: startsWith('Units of measure') }),
    )
    await userEvent.click(canvas.getByRole('radio', { name: startsWith('One trading partner') }))
    await expect(canvas.queryByRole('heading', { name: 'Suggested values' })).toBeNull()

    await userEvent.click(await canvas.findByRole('combobox', { name: 'Trading partner' }))
    await userEvent.click(await screen.findByRole('option', { name: hansemarkt.name }))

    await expect(await canvas.findByRole('heading', { name: /^Suggested values/ })).toBeVisible()
    await expect(canvas.getByText(/^Creates/)).toHaveTextContent(
      `Creates Units of measure for ${hansemarkt.name} with no values.`,
    )
  },
})

export const SuggestionsLoading = meta.story({
  beforeEach({ msw }) {
    msw.use(
      suggestionsResponding(async () => {
        await delay('infinite')

        return HttpResponse.json({ entries: [] })
      }),
    )
  },
  async play({ canvas, canvasElement }) {
    await chooseKindAndEveryPartner(canvasElement)

    await expect(await canvas.findByText('Loading suggested values')).toBeInTheDocument()
    await expect(canvas.getByRole('region', { name: 'Suggested values' })).toHaveAttribute(
      'aria-busy',
      'true',
    )
  },
})

export const SuggestionsError = meta.story({
  beforeEach({ msw }) {
    msw.use(suggestionsResponding(() => HttpResponse.json({ message: 'Down' }, { status: 500 })))
  },
  async play({ canvas, canvasElement }) {
    await chooseKindAndEveryPartner(canvasElement)

    await expect(await canvas.findByText('Suggestions unavailable')).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Try again' })).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Add a value' })).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Create list' })).toBeEnabled()
  },
})

export const SuggestionsEmpty = meta.story({
  beforeEach({ msw }) {
    msw.use(suggestionsResponding(() => HttpResponse.json({ entries: [] })))
  },
  async play({ canvas, canvasElement }) {
    await chooseKindAndEveryPartner(canvasElement)

    await expect(
      await canvas.findByText('There are no suggestions for this kind. Add your own values below.'),
    ).toBeVisible()
    await expect(canvas.getByRole('form', { name: 'Add a value' })).toBeVisible()
  },
})

export const AcceptAndEditSuggestions = meta.story({
  async play({ canvas, canvasElement }) {
    await chooseKindAndEveryPartner(canvasElement)
    const suggestions = await suggestionList(canvasElement)

    await userEvent.click(await suggestions.findByRole('button', { name: 'Accept ST' }))
    await expect(suggestions.getByRole('textbox', { name: 'Send KRT as' })).toHaveFocus()

    const krt = suggestions.getByRole('textbox', { name: 'Send KRT as' })

    await userEvent.clear(krt)
    await userEvent.type(krt, 'PK')
    await userEvent.click(suggestions.getByRole('button', { name: 'Accept KRT' }))
    await userEvent.click(suggestions.getByRole('button', { name: 'Skip KG' }))

    await expect(canvas.getByText('1 suggestion skipped')).toBeVisible()
    const values = within(canvas.getByRole('list', { name: /^Values in the new list/ }))

    await expect(values.getAllByRole('listitem').map(({ textContent }) => textContent)).toEqual([
      expect.stringMatching(/^ST.*PCE.*Piece/),
      expect.stringMatching(/^KRT.*PK/),
    ])
    await expect(canvas.getByText(/^Creates/)).toHaveTextContent(
      'Creates Units of measure (2) with 2 values.',
    )
    await expect(canvas.getByText('1 suggestion you have not accepted is left out.')).toBeVisible()

    await userEvent.click(canvas.getByRole('button', { name: 'Create list' }))
    await waitFor(() =>
      expect(getRouter().push).toHaveBeenCalledWith(
        expect.stringMatching(/^\/code-translations\/[\w-]+$/),
      ),
    )
  },
})

export const EmptyTargetIsRejected = meta.story({
  async play({ canvas, canvasElement }) {
    await chooseKindAndEveryPartner(canvasElement)
    const suggestions = await suggestionList(canvasElement)
    const st = await suggestions.findByRole('textbox', { name: 'Send ST as' })

    await userEvent.clear(st)
    await userEvent.click(suggestions.getByRole('button', { name: 'Accept ST' }))

    await expect(st).toHaveAccessibleDescription('Enter a code.')
    await expect(
      canvas.getByText('No values yet. Accept a suggestion or add your own.'),
    ).toBeVisible()
  },
})

export const CreateError = meta.story({
  beforeEach({ msw }) {
    msw.use(
      http.post(`${apiUrl}${createLookupTableEndpoint.path}`, () =>
        HttpResponse.json({ message: 'Down' }, { status: 500 }),
      ),
    )
  },
  async play({ canvas, canvasElement }) {
    await chooseKindAndEveryPartner(canvasElement, 'countries')
    await userEvent.click(await canvas.findByRole('button', { name: 'Create list' }))

    await expect(await canvas.findByRole('alert')).toHaveTextContent(
      'The list could not be created. Try again.',
    )
    await expect(getRouter().push).not.toHaveBeenCalled()
  },
})

export const ManyTradingPartners = meta.story({
  beforeEach({ msw }) {
    msw.use(...tradingPartnerHandlers(apiUrl, { tradingPartners: manyTradingPartners }))
  },
  async play({ canvas }) {
    await userEvent.click(await canvas.findByRole('radio', { name: startsWith('Countries') }))
    await userEvent.click(canvas.getByRole('radio', { name: startsWith('One trading partner') }))
    await userEvent.click(await canvas.findByRole('combobox', { name: 'Trading partner' }))

    await userEvent.click(await screen.findByRole('option', { name: lastTradingPartner.name }))

    await expect(await canvas.findByText(/^Creates/)).toHaveTextContent(
      `Creates Countries for ${lastTradingPartner.name} with no values.`,
    )
  },
})

export const German = meta.story({
  decorators: [german],
  async play({ canvas }) {
    await userEvent.click(await canvas.findByRole('radio', { name: startsWith('Mengeneinheiten') }))
    await userEvent.click(canvas.getByRole('radio', { name: startsWith('Jeder Partner') }))

    const suggestions = within(await canvas.findByRole('list', { name: /^Vorgeschlagene Werte/ }))

    await expect(await suggestions.findByRole('button', { name: 'Übernehmen: ST' })).toBeVisible()
    await expect(canvas.getByText(/^Legt/)).toHaveTextContent(
      'Legt Mengeneinheiten mit keinen Werten an.',
    )
  },
})

export const Dark = meta.story({
  beforeEach() {
    return darkMode()
  },
  async play({ canvas, canvasElement }) {
    await chooseKindAndEveryPartner(canvasElement)
    const suggestions = await suggestionList(canvasElement)

    await userEvent.click(await suggestions.findByRole('button', { name: 'Accept ST' }))
    await expect(
      within(canvas.getByRole('list', { name: /^Values in the new list/ })).getByText('PCE'),
    ).toBeVisible()
  },
})

export const Mobile = meta.story({
  ...mobile,
  async play({ canvasElement }) {
    await chooseKindAndEveryPartner(canvasElement)
    await (await suggestionList(canvasElement)).findByRole('button', { name: 'Accept ST' })
    await expectNoPageScroll(canvasElement)
  },
})
