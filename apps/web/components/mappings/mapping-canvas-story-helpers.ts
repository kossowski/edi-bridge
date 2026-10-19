import { expect, fireEvent, userEvent, waitFor, within } from 'storybook/test'

import type { ReactRenderer, StoryContext } from '@storybook/nextjs-vite'
import type { BeforeEach } from 'storybook/internal/csf'

import { nodeId } from '@/components/mappings/mapping-tree'
import { findRowButton, rowOfButton } from '@/components/mappings/tree-node'
import { apiUrl } from '@/lib/api/config'
import { mappingDraftEndpoint, toPath } from '@edi-bridge/contracts'
import {
  type AiProposalSize,
  aiProposalFor,
  createHandlers,
  type MappingDraftRecord,
  seedDocumentStructures,
  seedMappingDrafts,
  seedMappingSamples,
  withAiProposal,
} from '@edi-bridge/mocks'

import type { RowRef } from '@/components/mappings/mapping-links'
import type { AiProposal } from '@edi-bridge/contracts'

export function seeded(name: string) {
  return seedMappingDrafts.find((draft) => draft.name === name && draft.latestVersion !== null)!
}

export function inReviewWith(name: string, proposal: AiProposal) {
  const record = seeded(name)
  const sample = seedMappingSamples.find(({ mappingId }) => mappingId === record.id)!

  return withAiProposal(record, sample.id, proposal)
}

export function inReview(name: string, size: AiProposalSize = 'regular') {
  return inReviewWith(name, aiProposalFor(seeded(name), seedDocumentStructures, size))
}

export function reviewing(record: MappingDraftRecord): BeforeEach<ReactRenderer> {
  return ({ msw }: StoryContext) => {
    msw.use(
      ...createHandlers(apiUrl, {
        mappingDrafts: seedMappingDrafts.map((draft) => (draft.id === record.id ? record : draft)),
      }),
    )
  }
}

// The tooltip renders in a portal outside the story's root.
export function page(canvasElement: HTMLElement) {
  return within(canvasElement.ownerDocument.body)
}

export async function findAlert(canvasElement: HTMLElement, title: string) {
  const alert = await waitFor(
    () => {
      const found = within(canvasElement)
        .getAllByRole('alert')
        .find((element) => element.textContent.includes(title))

      if (!found) {
        throw new Error(`No alert with ${title}`)
      }

      return found
    },
    { timeout: 5000 },
  )

  return within(alert)
}

function rowOrThrow(canvasElement: HTMLElement, ref: RowRef) {
  const row = findRowButton(canvasElement, ref)

  if (!row) {
    throw new Error(`No row ${ref.side}:${ref.path}`)
  }

  return row
}

export async function findRow(canvasElement: HTMLElement, ref: RowRef) {
  return waitFor(() => rowOrThrow(canvasElement, ref))
}

// React Flow shows rows only once measured, which on a large draft can pass the default second.
export async function findDrawnRow(canvasElement: HTMLElement, ref: RowRef) {
  return waitFor(
    async () => {
      const row = rowOrThrow(canvasElement, ref)

      await expect(row).toBeVisible()

      return row
    },
    { timeout: 5000 },
  )
}

// A port of a transform, found by the transform's name, e.g. `in:part1` of Concatenate 1.
export type PortHandle = { transform: string; handle: string }

export type HandleRef = RowRef | PortHandle

export function transformNodeOf(canvasElement: HTMLElement, name: string) {
  return within(canvasElement)
    .getByRole('group', { name: `Transform ${name}` })
    .closest<HTMLElement>('.react-flow__node')!
}

export function handleOf(canvasElement: HTMLElement, ref: HandleRef) {
  if ('transform' in ref) {
    return transformNodeOf(canvasElement, ref.transform).querySelector<HTMLElement>(
      `.react-flow__handle[data-handleid="${CSS.escape(ref.handle)}"]`,
    )!
  }

  return canvasElement.querySelector<HTMLElement>(
    `.react-flow__node[data-id="${CSS.escape(nodeId(ref.side, ref.path))}"] .react-flow__handle`,
  )!
}

function centre(element: Element) {
  const { left, top, width, height } = element.getBoundingClientRect()

  return { clientX: left + width / 2, clientY: top + height / 2 }
}

// React Flow follows mouse events on the document while a link is drawn; user-event moves no
// real pointer, so the drag is dispatched as those events at the handles' positions.
export async function startDrag(canvasElement: HTMLElement, from: HandleRef) {
  const start = centre(handleOf(canvasElement, from))

  await fireEvent.mouseDown(handleOf(canvasElement, from), { ...start, button: 0, buttons: 1 })
  await fireEvent.mouseMove(canvasElement.ownerDocument, {
    clientX: start.clientX + 20,
    clientY: start.clientY,
    buttons: 1,
  })
}

export async function dragOver(canvasElement: HTMLElement, to: HandleRef) {
  await fireEvent.mouseMove(canvasElement.ownerDocument, {
    ...centre(handleOf(canvasElement, to)),
    buttons: 1,
  })
  await waitFor(() => expect(handleOf(canvasElement, to)).toHaveClass('connectingto'))
}

export async function drop(canvasElement: HTMLElement, on: HandleRef) {
  await fireEvent.mouseUp(canvasElement.ownerDocument, {
    ...centre(handleOf(canvasElement, on)),
    button: 0,
  })
}

export async function dragLink(canvasElement: HTMLElement, from: HandleRef, to: HandleRef) {
  await startDrag(canvasElement, from)
  await dragOver(canvasElement, to)
  await drop(canvasElement, to)
}

export function liveStatus(canvasElement: HTMLElement) {
  return canvasElement.querySelector('p[role="status"].sr-only')!
}

// Each save is a request to the mock API, which a busy CI runner can answer later than the default
// second of findBy* allows.
export function findSaveStatus(canvasElement: HTMLElement, status: 'Saved' | 'Not saved') {
  return within(canvasElement).findByText(status, {}, { timeout: 5000 })
}

export async function pressOn(element: HTMLElement, keys: string) {
  element.focus()
  await userEvent.keyboard(keys)
}

export const source = (path: string): RowRef => ({ side: 'source', path })

export const target = (path: string): RowRef => ({ side: 'target', path })

// A sheet renders in a portal outside the story's root, and fades in. A busy CI runner can take
// longer than the default second to finish the open transition.
export async function findSheetElement(canvasElement: HTMLElement, name: string) {
  const wait = { timeout: 5000 }
  const sheet = await page(canvasElement).findByRole('dialog', { name }, wait)

  await waitFor(() => expect(sheet).toBeVisible(), wait)

  return sheet
}

export async function findSheet(canvasElement: HTMLElement, name: string) {
  return within(await findSheetElement(canvasElement, name))
}

export function detailsPanel(canvasElement: HTMLElement, name = 'Details') {
  return findSheet(canvasElement, name)
}

export async function openDetails(canvasElement: HTMLElement, name = 'Details') {
  await userEvent.click(await within(canvasElement).findByRole('button', { name }))

  const sheet = await findSheetElement(canvasElement, name)

  // The sheet takes the focus a frame or more after it shows; a key pressed before then misses it.
  await waitFor(() => expect(sheet.contains(sheet.ownerDocument.activeElement)).toBe(true), {
    timeout: 5000,
  })

  return within(sheet)
}

// The counts live in the Details sheet now; the stories check what the canvas shows or saved.
export async function expectTransformCount(canvasElement: HTMLElement, count: number) {
  await waitFor(() =>
    expect(canvasElement.querySelectorAll('.react-flow__node-transform')).toHaveLength(count),
  )
}

export async function expectSavedLinkCount(id: string, count: number) {
  await waitFor(
    async () => {
      const response = await fetch(`${apiUrl}${toPath(mappingDraftEndpoint.path, { id })}`)
      const saved = mappingDraftEndpoint.response.parse(await response.json())

      await expect(saved.links.length + saved.transformLinks.length).toBe(count)
    },
    { timeout: 5000 },
  )
}

// The wide, unseen line along a link that takes the pointer.
export async function findLinkLine(canvasElement: HTMLElement, name: string) {
  const link = await within(canvasElement).findByRole('group', { name })

  return link.querySelector<SVGPathElement>('.react-flow__edge-interaction')!
}

// The menu renders in a portal outside the story's root, and fades in.
export async function findLinkMenu(canvasElement: HTMLElement) {
  const menu = await page(canvasElement).findByRole('menu')

  await waitFor(() => expect(menu).toBeVisible())

  return within(menu)
}

export async function openLinkMenuByMouse(canvasElement: HTMLElement, name: string) {
  await userEvent.pointer({ keys: '[MouseRight]', target: await findLinkLine(canvasElement, name) })

  return findLinkMenu(canvasElement)
}

export async function openLinkMenuByKeyboard(
  canvasElement: HTMLElement,
  name: string,
  keys = '{Shift>}{F10}{/Shift}',
) {
  await pressOn(await within(canvasElement).findByRole('group', { name }), keys)

  return findLinkMenu(canvasElement)
}

// An empty Mapping opens on "Start here"; this takes the path that opens the empty editor.
// The editor focuses its first source row frames later, taking the focus from a row focused before.
export async function openEmptyEditor(canvasElement: HTMLElement, name = 'Open the empty editor') {
  await userEvent.click(await within(canvasElement).findByRole('button', { name }))
  await waitFor(
    () => expect(rowOfButton(canvasElement.ownerDocument.activeElement)?.side).toBe('source'),
    { timeout: 5000 },
  )
}
