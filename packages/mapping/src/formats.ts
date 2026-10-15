const dateTokens = ['yyyy', 'yy', 'MM', 'dd', 'HH', 'mm', 'ss'] as const

type DateToken = (typeof dateTokens)[number]

const isDateToken = (part: string): part is DateToken => dateTokens.some((token) => token === part)

const tokensOf = (pattern: string) =>
  pattern.split(new RegExp(`(${dateTokens.join('|')})`)).filter((part) => part !== '')

function dateParts(value: string, pattern: string): Partial<Record<DateToken, string>> | undefined {
  const parts: Partial<Record<DateToken, string>> = {}
  let rest = value

  for (const token of tokensOf(pattern)) {
    const read = rest.slice(0, token.length)

    if (isDateToken(token) ? !/^\d+$/.test(read) || read.length < token.length : read !== token) {
      return undefined
    }

    if (isDateToken(token)) {
      parts[token] = read
    }

    rest = rest.slice(token.length)
  }

  return rest === '' ? parts : undefined
}

const pad = (value: number, length: number) => String(value).padStart(length, '0')

// A two-digit year falls in this century.
export function reformatDate(value: string, from: string, to: string): string | undefined {
  const parts = dateParts(value, from)

  if (parts === undefined) {
    return undefined
  }

  const numberOf = (token: DateToken) => Number(parts[token] ?? 0)
  const date = new Date(Date.UTC(0, 0, 1, numberOf('HH'), numberOf('mm'), numberOf('ss')))

  date.setUTCFullYear(Number(parts.yyyy ?? `20${parts.yy}`), numberOf('MM') - 1, numberOf('dd'))

  const fields: Record<DateToken, string> = {
    yyyy: pad(date.getUTCFullYear(), 4),
    yy: pad(date.getUTCFullYear() % 100, 2),
    MM: pad(date.getUTCMonth() + 1, 2),
    dd: pad(date.getUTCDate(), 2),
    HH: pad(date.getUTCHours(), 2),
    mm: pad(date.getUTCMinutes(), 2),
    ss: pad(date.getUTCSeconds(), 2),
  }

  const read = dateTokens.every(
    (token) => parts[token] === undefined || parts[token] === fields[token],
  )

  return read
    ? tokensOf(to)
        .map((token) => (isDateToken(token) ? fields[token] : token))
        .join('')
    : undefined
}
