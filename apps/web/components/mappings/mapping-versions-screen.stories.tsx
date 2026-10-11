import { delay, http, HttpResponse } from 'msw'
import { NextIntlClientProvider } from 'next-intl'
import { expect, within } from 'storybook/test'

import { MappingVersionsScreen } from '@/components/mappings/mapping-versions-screen'
import { apiUrl } from '@/lib/api/config'
import messagesDe from '@/messages/de.json'
import { mappingVersionsEndpoint, toPath } from '@edi-bridge/contracts'
import {
  createHandlers,
  createMappingDrafts,
  createMappingVersions,
  seedMappingDrafts,
} from '@edi-bridge/mocks'

import preview from '../../.storybook/preview'

const published = seedMappingDrafts.find(({ name }) => name === 'Hansemarkt: ORDERS to ERP JSON')!

const neverPublished = seedMappingDrafts.find(({ latestVersion }) => latestVersion === null)!

const [long] = createMappingDrafts({ count: 1 }).map((draft) => ({
  ...draft,
  latestVersion: 300,
  unpublishedChanges: true,
}))

const versionsPath = (mappingId: string) =>
  `${apiUrl}${toPath(mappingVersionsEndpoint.path, { mappingId })}`

const meta = preview.meta({
  title: 'Mappings/MappingVersionsScreen',
  component: MappingVersionsScreen,
  parameters: { layout: 'fullscreen' },
  args: { id: published.id },
  beforeEach({ msw }) {
    msw.use(...createHandlers(apiUrl))
  },
})

export const Default = meta.story({
  async play({ canvas }) {
    await expect(await canvas.findByText('3 Mapping Versions')).toBeVisible()
    await expect(
      canvas.getByRole('heading', { level: 1, name: `Versions of ${published.name}` }),
    ).toBeInTheDocument()
    await expect(canvas.getByText('No changes since Version 3')).toBeVisible()

    const newest = within(canvas.getByText('Version 3').closest('tr')!)

    await expect(newest.getByText('Latest')).toBeVisible()
    await expect(canvas.getByRole('link', { name: 'Open the Draft' })).toHaveAttribute(
      'href',
      `/mappings/${published.id}`,
    )
    await expect(canvas.getByRole('link', { name: 'Compare versions' })).toHaveAttribute(
      'href',
      `/mappings/${published.id}/versions/compare`,
    )
    await expect(newest.getByRole('link', { name: 'Compare with Version 2' })).toBeVisible()
    await expect(
      within(canvas.getByText('Version 1').closest('tr')!).queryByRole('link'),
    ).not.toBeInTheDocument()
  },
})

export const Empty = meta.story({
  args: { id: neverPublished.id },
  async play({ canvas }) {
    await expect(await canvas.findByText('No Mapping Versions yet')).toBeVisible()
    await expect(canvas.getByText('Never published')).toBeVisible()
    await expect(canvas.queryByRole('link', { name: 'Compare versions' })).not.toBeInTheDocument()
  },
})

export const Loading = meta.story({
  beforeEach({ msw }) {
    msw.use(
      http.get(versionsPath(published.id), async () => {
        await delay('infinite')
      }),
    )
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('Loading Mapping Versions')).toBeInTheDocument()
  },
})

export const Unavailable = meta.story({
  beforeEach({ msw }) {
    msw.use(
      http.get(versionsPath(published.id), () =>
        HttpResponse.json({ message: 'Internal Server Error' }, { status: 500 }),
      ),
    )
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('Mapping Versions unavailable')).toBeVisible()
  },
})

export const NotFound = meta.story({
  args: { id: '00000000-0000-4000-8000-000000000000' },
  async play({ canvas }) {
    await expect(await canvas.findByText('Mapping not found')).toBeVisible()
  },
})

export const LargeVolume = meta.story({
  args: { id: long!.id },
  beforeEach({ msw }) {
    msw.use(
      ...createHandlers(apiUrl, {
        mappingDrafts: [long!],
        mappingVersions: createMappingVersions([long!]),
      }),
    )
  },
  // Contrast is checked on the same rows in the small stories. Over a large DOM it makes axe
  // outrun the test timeout on CI, so only the structural rules run here.
  parameters: { a11y: { config: { rules: [{ id: 'color-contrast', enabled: false }] } } },
  async play({ canvas }) {
    await expect(await canvas.findByText('300 Mapping Versions')).toBeVisible()
    await expect(canvas.getByText('Unpublished changes since Version 300')).toBeVisible()
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
    await expect(await canvas.findByText('3 Mapping Versions')).toBeVisible()
    await expect(canvas.getByText('Keine Änderungen seit Version 3')).toBeVisible()
    await expect(canvas.getByText('Neueste')).toBeVisible()
  },
})

export const Dark = meta.story({
  beforeEach() {
    document.documentElement.classList.add('dark')

    return () => document.documentElement.classList.remove('dark')
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('3 Mapping Versions')).toBeVisible()
  },
})
