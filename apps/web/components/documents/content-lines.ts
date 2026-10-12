import type { FixTarget, ParsedMessage } from '@edi-bridge/contracts'

export const contentColumns = ['item', 'gtin', 'quantity', 'unit', 'amount'] as const

export type ContentColumn = (typeof contentColumns)[number]

export type ContentLine = { line: string } & Record<ContentColumn, string | null>

export type MissingPiece = { kind: 'code'; code: string } | { kind: 'field'; column: ContentColumn }

function valueOf(elements: string[][], element: number, component: number) {
  const value = elements[element]?.[component]

  return value === undefined || value === '' ? null : value
}

export function contentLines(message: ParsedMessage): ContentLine[] {
  const lines: ContentLine[] = []

  for (const { tag, elements } of message.segments) {
    const current = lines.at(-1)

    if (tag === 'LIN') {
      lines.push({
        line: valueOf(elements, 0, 0) ?? String(lines.length + 1),
        item: null,
        gtin: valueOf(elements, 2, 0),
        quantity: null,
        unit: null,
        amount: null,
      })
    } else if (current === undefined) {
      continue
    } else if (tag === 'IMD') {
      current.item ??= valueOf(elements, 2, 3)
    } else if (tag === 'QTY' && current.quantity === null) {
      current.quantity = valueOf(elements, 0, 1)
      current.unit = valueOf(elements, 0, 2)
    } else if (tag === 'MOA' && valueOf(elements, 0, 0) === '203') {
      current.amount = valueOf(elements, 0, 1)
    }
  }

  return lines
}

export function shownColumns(lines: readonly ContentLine[]): ContentColumn[] {
  return contentColumns.filter(
    (column) =>
      column === 'gtin' || column === 'quantity' || lines.some((line) => line[column] !== null),
  )
}

const fieldColumns = new Map<string, ContentColumn>([
  ['gtin', 'gtin'],
  ['quantity', 'quantity'],
  ['unit', 'unit'],
  ['description', 'item'],
  ['amount', 'amount'],
])

export function missingPieceOf(fixTarget: FixTarget | null): MissingPiece | null {
  switch (fixTarget?.kind) {
    case 'lookupTable': {
      return { kind: 'code', code: fixTarget.code }
    }

    case 'mapping': {
      const field = /lines\[\]\.(\w+)$/.exec(fixTarget.fieldPath)?.[1]
      const column = field === undefined ? undefined : fieldColumns.get(field)

      return column ? { kind: 'field', column } : null
    }

    default: {
      return null
    }
  }
}

export function isMissing(line: ContentLine, column: ContentColumn, piece: MissingPiece | null) {
  switch (piece?.kind) {
    case 'code': {
      return line[column] === piece.code
    }

    case 'field': {
      return piece.column === column && line[column] === null
    }

    default: {
      return false
    }
  }
}
