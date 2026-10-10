export type CellPosition = { row: number; column: number }

export type GridSize = { rows: number; columns: number; firstTabColumn: number; pageRows: number }

export type GridMove =
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  | 'rowStart'
  | 'rowEnd'
  | 'gridStart'
  | 'gridEnd'
  | 'pageUp'
  | 'pageDown'
  | 'next'
  | 'previous'

export type GridCommand =
  | { kind: 'move'; move: GridMove }
  | { kind: 'edit' }
  | { kind: 'type'; text: string }
  | { kind: 'commit' }
  | { kind: 'cancel' }
  | { kind: 'add' }
  | { kind: 'delete' }
  | { kind: 'save' }

export type KeyPress = {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  altKey: boolean
}

function arrowMove(key: string): GridMove | null {
  switch (key) {
    case 'ArrowUp':
      return 'up'
    case 'ArrowDown':
      return 'down'
    case 'ArrowLeft':
      return 'left'
    case 'ArrowRight':
      return 'right'
    case 'PageUp':
      return 'pageUp'
    case 'PageDown':
      return 'pageDown'
    default:
      return null
  }
}

export function gridCommand(press: KeyPress, editing: boolean): GridCommand | null {
  const command = press.ctrlKey || press.metaKey

  if (command && press.key === 'Enter') {
    return { kind: 'add' }
  }

  if (command && press.key.toLowerCase() === 's') {
    return { kind: 'save' }
  }

  if (press.key === 'Tab') {
    return { kind: 'move', move: press.shiftKey ? 'previous' : 'next' }
  }

  if (editing) {
    if (press.key === 'Enter') {
      return { kind: 'commit' }
    }

    return press.key === 'Escape' ? { kind: 'cancel' } : null
  }

  if ((press.ctrlKey && press.key === 'Delete') || (press.metaKey && press.key === 'Backspace')) {
    return { kind: 'delete' }
  }

  if (press.key === 'Home' || press.key === 'End') {
    const start = press.key === 'Home'

    return {
      kind: 'move',
      move: command ? (start ? 'gridStart' : 'gridEnd') : start ? 'rowStart' : 'rowEnd',
    }
  }

  const move = arrowMove(press.key)

  if (move) {
    return { kind: 'move', move }
  }

  if (press.key === 'Enter' || press.key === 'F2') {
    return { kind: 'edit' }
  }

  return press.key.length === 1 && !command && !press.altKey
    ? { kind: 'type', text: press.key }
    : null
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function tabStep({ row, column }: CellPosition, size: GridSize, step: 1 | -1) {
  const tabColumns = size.columns - size.firstTabColumn
  const flat = row * tabColumns + (column - size.firstTabColumn) + step

  if (column < size.firstTabColumn) {
    return step === 1
      ? { row, column: size.firstTabColumn }
      : row > 0
        ? { row: row - 1, column: size.columns - 1 }
        : null
  }

  if (flat < 0 || flat >= size.rows * tabColumns) {
    return null
  }

  return {
    row: Math.floor(flat / tabColumns),
    column: (flat % tabColumns) + size.firstTabColumn,
  }
}

export function moveCell(
  position: CellPosition,
  move: GridMove,
  size: GridSize,
): CellPosition | null {
  const lastRow = size.rows - 1
  const lastColumn = size.columns - 1
  const { row, column } = position

  switch (move) {
    case 'up':
      return { row: clamp(row - 1, 0, lastRow), column }
    case 'down':
      return { row: clamp(row + 1, 0, lastRow), column }
    case 'left':
      return { row, column: clamp(column - 1, 0, lastColumn) }
    case 'right':
      return { row, column: clamp(column + 1, 0, lastColumn) }
    case 'rowStart':
      return { row, column: 0 }
    case 'rowEnd':
      return { row, column: lastColumn }
    case 'gridStart':
      return { row: 0, column: 0 }
    case 'gridEnd':
      return { row: lastRow, column: lastColumn }
    case 'pageUp':
      return { row: clamp(row - size.pageRows, 0, lastRow), column }
    case 'pageDown':
      return { row: clamp(row + size.pageRows, 0, lastRow), column }
    case 'next':
      return tabStep(position, size, 1)
    case 'previous':
      return tabStep(position, size, -1)
  }
}
