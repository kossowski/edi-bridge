import { expect, fireEvent, userEvent, waitFor, within } from 'storybook/test'

import { nodeId } from '@/components/mappings/mapping-tree'
import { findRowButton } from '@/components/mappings/tree-node'
import { seedMappingDrafts } from '@edi-bridge/mocks'

import type { RowRef } from '@/components/mappings/mapping-links'

export function seeded(name: string) {
  return seedMappingDrafts.find((draft) => draft.name === name && draft.latestVersion !== null)!
}

// The tooltip renders in a portal outside the story's root.
export function page(canvasElement: HTMLElement) {
  return within(canvasElement.ownerDocument.body)
}

export async function findRow(canvasElement: HTMLElement, ref: RowRef) {
  return waitFor(() => {
    const row = findRowButton(canvasElement, ref)

    if (!row) {
      throw new Error(`No row ${ref.side}:${ref.path}`)
    }

    return row
  })
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

export function detailsPanel(canvasElement: HTMLElement, name = 'Details') {
  return within(page(canvasElement).getByRole('region', { name }))
}
