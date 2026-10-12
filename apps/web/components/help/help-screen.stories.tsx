import { expect, userEvent } from 'storybook/test'

import { HelpScreen } from '@/components/help/help-screen'
import { darkMode, german, mobile } from '@/components/story-helpers'
import { glossaryEntries } from '@/lib/glossary'

import preview from '../../.storybook/preview'

const meta = preview.meta({
  title: 'Help/HelpScreen',
  component: HelpScreen,
  parameters: { layout: 'fullscreen', nextjs: { navigation: { pathname: '/help' } } },
})

export const English = meta.story({
  async play({ canvas, canvasElement }) {
    await expect(canvas.getByRole('heading', { level: 1, name: 'Help & glossary' })).toBeVisible()
    await expect(canvas.getByText(`${glossaryEntries.length} entries`)).toBeVisible()

    const lookupTable = canvasElement.querySelector('#lookup-table')

    await expect(lookupTable).toHaveTextContent('Code translation')
    await expect(lookupTable).toHaveTextContent('Technical term: Lookup Table')
    await expect(canvasElement.querySelector('#orders')).toHaveTextContent('Purchase order')
    await expect(canvasElement.querySelector('#orders')).toHaveTextContent('Message Type ORDERS')
  },
})

export const Search = meta.story({
  async play({ canvas }) {
    await userEvent.type(canvas.getByRole('searchbox', { name: 'Search the glossary' }), 'RUN')

    await expect(canvas.getByText(`1 of ${glossaryEntries.length} entries`)).toBeVisible()
    await expect(canvas.getByRole('term')).toHaveTextContent('Document')
  },
})

export const SearchByExplanation = meta.story({
  async play({ canvas }) {
    await userEvent.type(canvas.getByRole('searchbox', { name: 'Search the glossary' }), 'sftp')

    await expect(canvas.getByRole('term')).toHaveTextContent('Connection')
  },
})

export const NoResults = meta.story({
  async play({ canvas }) {
    await userEvent.type(canvas.getByRole('searchbox', { name: 'Search the glossary' }), 'nordpol')

    await expect(canvas.getByText('No matching entry')).toBeVisible()
    await expect(canvas.getByText(`0 of ${glossaryEntries.length} entries`)).toBeVisible()
    await expect(canvas.queryByRole('term')).toBeNull()
  },
})

export const German = meta.story({
  decorators: [german],
  async play({ canvas, canvasElement }) {
    await expect(canvas.getByRole('heading', { level: 1, name: 'Hilfe & Glossar' })).toBeVisible()
    await expect(canvasElement.querySelector('#lookup-table')).toHaveTextContent('Code-Übersetzung')
    await expect(canvasElement.querySelector('#run')).toHaveTextContent('Beleg')
    await userEvent.type(
      canvas.getByRole('searchbox', { name: 'Glossar durchsuchen' }),
      'lieferavis',
    )
    await expect(canvas.getByText('Lieferavis', { selector: 'dt' })).toBeVisible()
    await expect(canvas.queryByText('Code-Übersetzung')).toBeNull()
  },
})

export const Dark = meta.story({ beforeEach: darkMode })

export const Mobile = meta.story({ ...mobile })
