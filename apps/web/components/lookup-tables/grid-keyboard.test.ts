import { describe, expect, it } from 'vitest'

import { gridCommand, type KeyPress, moveCell } from './grid-keyboard'

function press(key: string, modifiers: Partial<Omit<KeyPress, 'key'>> = {}): KeyPress {
  return { key, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...modifiers }
}

const size = { rows: 3, columns: 4, firstTabColumn: 1, pageRows: 10 }

describe('gridCommand', () => {
  it('moves with arrow, Home, End and page keys while navigating', () => {
    expect(gridCommand(press('ArrowDown'), false)).toEqual({ kind: 'move', move: 'down' })
    expect(gridCommand(press('Home'), false)).toEqual({ kind: 'move', move: 'rowStart' })
    expect(gridCommand(press('End', { ctrlKey: true }), false)).toEqual({
      kind: 'move',
      move: 'gridEnd',
    })
    expect(gridCommand(press('PageDown'), false)).toEqual({ kind: 'move', move: 'pageDown' })
  })

  it('leaves arrow keys to the text field while editing', () => {
    expect(gridCommand(press('ArrowLeft'), true)).toBeNull()
    expect(gridCommand(press('Home'), true)).toBeNull()
  })

  it('starts editing with Enter, F2 or a typed character', () => {
    expect(gridCommand(press('Enter'), false)).toEqual({ kind: 'edit' })
    expect(gridCommand(press('F2'), false)).toEqual({ kind: 'edit' })
    expect(gridCommand(press('K'), false)).toEqual({ kind: 'type', text: 'K' })
    expect(gridCommand(press('k', { ctrlKey: true }), false)).toBeNull()
  })

  it('commits with Enter and cancels with Escape while editing', () => {
    expect(gridCommand(press('Enter'), true)).toEqual({ kind: 'commit' })
    expect(gridCommand(press('Escape'), true)).toEqual({ kind: 'cancel' })
    expect(gridCommand(press('Escape'), false)).toBeNull()
  })

  it('moves to the next or previous cell with Tab in both modes', () => {
    expect(gridCommand(press('Tab'), true)).toEqual({ kind: 'move', move: 'next' })
    expect(gridCommand(press('Tab', { shiftKey: true }), false)).toEqual({
      kind: 'move',
      move: 'previous',
    })
  })

  it('adds a row with Ctrl or Cmd and Enter, also while editing', () => {
    expect(gridCommand(press('Enter', { ctrlKey: true }), false)).toEqual({ kind: 'add' })
    expect(gridCommand(press('Enter', { metaKey: true }), true)).toEqual({ kind: 'add' })
  })

  it('deletes a row with Ctrl+Delete or Cmd+Backspace only while navigating', () => {
    expect(gridCommand(press('Delete', { ctrlKey: true }), false)).toEqual({ kind: 'delete' })
    expect(gridCommand(press('Backspace', { metaKey: true }), false)).toEqual({ kind: 'delete' })
    expect(gridCommand(press('Delete', { ctrlKey: true }), true)).toBeNull()
    expect(gridCommand(press('Delete'), false)).toBeNull()
  })

  it('saves with Ctrl or Cmd and S', () => {
    expect(gridCommand(press('s', { ctrlKey: true }), true)).toEqual({ kind: 'save' })
    expect(gridCommand(press('S', { metaKey: true, shiftKey: true }), false)).toEqual({
      kind: 'save',
    })
  })
})

describe('moveCell', () => {
  it('stays inside the grid at its edges', () => {
    expect(moveCell({ row: 0, column: 0 }, 'up', size)).toEqual({ row: 0, column: 0 })
    expect(moveCell({ row: 2, column: 3 }, 'right', size)).toEqual({ row: 2, column: 3 })
    expect(moveCell({ row: 2, column: 1 }, 'down', size)).toEqual({ row: 2, column: 1 })
  })

  it('jumps to the row and grid ends', () => {
    expect(moveCell({ row: 1, column: 2 }, 'rowStart', size)).toEqual({ row: 1, column: 0 })
    expect(moveCell({ row: 1, column: 2 }, 'rowEnd', size)).toEqual({ row: 1, column: 3 })
    expect(moveCell({ row: 1, column: 2 }, 'gridEnd', size)).toEqual({ row: 2, column: 3 })
    expect(moveCell({ row: 1, column: 2 }, 'gridStart', size)).toEqual({ row: 0, column: 0 })
  })

  it('moves a page of rows at a time', () => {
    const large = { ...size, rows: 50 }

    expect(moveCell({ row: 5, column: 1 }, 'pageDown', large)).toEqual({ row: 15, column: 1 })
    expect(moveCell({ row: 5, column: 1 }, 'pageUp', large)).toEqual({ row: 0, column: 1 })
    expect(moveCell({ row: 45, column: 1 }, 'pageDown', large)).toEqual({ row: 49, column: 1 })
  })

  it('tabs through the editable columns and wraps to the next row', () => {
    expect(moveCell({ row: 0, column: 1 }, 'next', size)).toEqual({ row: 0, column: 2 })
    expect(moveCell({ row: 0, column: 3 }, 'next', size)).toEqual({ row: 1, column: 1 })
    expect(moveCell({ row: 1, column: 1 }, 'previous', size)).toEqual({ row: 0, column: 3 })
    expect(moveCell({ row: 1, column: 0 }, 'next', size)).toEqual({ row: 1, column: 1 })
    expect(moveCell({ row: 1, column: 0 }, 'previous', size)).toEqual({ row: 0, column: 3 })
  })

  it('leaves the grid when tabbing past its first or last cell', () => {
    expect(moveCell({ row: 0, column: 1 }, 'previous', size)).toBeNull()
    expect(moveCell({ row: 0, column: 0 }, 'previous', size)).toBeNull()
    expect(moveCell({ row: 2, column: 3 }, 'next', size)).toBeNull()
  })
})
