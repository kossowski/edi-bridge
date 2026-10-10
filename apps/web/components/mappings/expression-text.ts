const plainName = /^[A-Za-z_][A-Za-z0-9_]*$/

// Document paths mark list items with `[]` and EDIFACT paths separate parts with `/`; in JSONata
// both are plain steps, and a step like `NAD+DP` or `3207` needs backticks to be read as a name.
export function jsonataPath(path: string) {
  return path
    .split(/[./]/)
    .map((step) => step.replace(/\[\]$/, ''))
    .filter((step) => step !== '')
    .map((step) => (plainName.test(step) ? step : `\`${step.replaceAll('`', '')}\``))
    .join('.')
}

export type TextPosition = { line: number; column: number; offset: number }

// The parser's position counts up to and including the token it stopped at, so the column is that
// token's last character and the caret goes right after it.
export function textPosition(text: string, position: number): TextPosition {
  const offset = Math.min(Math.max(position, 0), text.length)
  const index = Math.max(offset - 1, 0)
  const before = text.slice(0, index)
  const lineStart = before.lastIndexOf('\n') + 1

  return { line: before.split('\n').length, column: index - lineStart + 1, offset }
}

export function insertText(value: string, start: number, end: number, text: string) {
  const from = Math.min(Math.max(start, 0), value.length)
  const to = Math.min(Math.max(end, from), value.length)

  return { value: `${value.slice(0, from)}${text}${value.slice(to)}`, caret: from + text.length }
}

// The parser's codes for the syntax errors users run into most; others keep the parser's English.
export const syntaxErrorCodes = [
  'S0101',
  'S0105',
  'S0106',
  'S0201',
  'S0202',
  'S0203',
  'S0204',
  'S0205',
  'S0207',
  'S0211',
  'S0212',
  'S0213',
  'S0301',
  'S0302',
] as const

export type SyntaxErrorCode = (typeof syntaxErrorCodes)[number]

export function knownSyntaxError(code: string | null): SyntaxErrorCode | null {
  return syntaxErrorCodes.find((known) => known === code) ?? null
}
