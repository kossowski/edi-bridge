import type {
  DocumentStructure,
  DocumentStructureNode,
  EdifactStructureNode,
  JsonContent,
  MessageTypeStructure,
} from '@edi-bridge/contracts'

export type Entry = { path: string; at: ReadonlyArray<number>; value: string }

// Repetitions match when the shorter index list starts the longer one, so a header value also
// reaches every line, and a value from a repeating group also fills a single field.
export function compatible(a: ReadonlyArray<number>, b: ReadonlyArray<number>) {
  const length = Math.min(a.length, b.length)

  for (let index = 0; index < length; index++) {
    if (a[index] !== b[index]) {
      return false
    }
  }

  return true
}

const atKey = (at: ReadonlyArray<number>) => at.join('/')

export type DocumentValues = {
  get: (path: string, at: ReadonlyArray<number>) => string | undefined
  entries: (path: string) => ReadonlyArray<Entry>
  beneath: (part: string) => ReadonlyArray<Entry>
  repetitions: (path: string, at: ReadonlyArray<number>) => number[]
}

function isBeneath(path: string, part: string) {
  return path === part || path.startsWith(`${part}/`) || path.startsWith(`${part}.`)
}

export function documentValues(entries: ReadonlyArray<Entry>): DocumentValues {
  const byPath = new Map<string, { list: Entry[]; exact: Map<string, string> }>()

  for (const entry of entries) {
    const known = byPath.get(entry.path) ?? { list: [], exact: new Map<string, string>() }

    known.list.push(entry)
    known.exact.set(atKey(entry.at), entry.value)
    byPath.set(entry.path, known)
  }

  const beneath = new Map<string, Entry[]>()

  const entriesBeneath = (part: string) => {
    const cached = beneath.get(part)

    if (cached) {
      return cached
    }

    const found = [...byPath.entries()].flatMap(([path, { list }]) =>
      isBeneath(path, part) ? list : [],
    )

    beneath.set(part, found)

    return found
  }

  return {
    get: (path, at) => {
      const known = byPath.get(path)

      if (!known) {
        return undefined
      }

      for (let length = at.length; length >= 0; length--) {
        const value = known.exact.get(atKey(at.slice(0, length)))

        if (value !== undefined) {
          return value
        }
      }

      return known.list.find((entry) => compatible(entry.at, at))?.value
    },
    entries: (path) => byPath.get(path)?.list ?? [],
    beneath: entriesBeneath,
    repetitions: (path, at) => {
      const depth = at.length
      const found = new Set<number>()
      let reached = false

      for (const entry of entriesBeneath(path)) {
        if (compatible(entry.at, at)) {
          reached = true

          if (entry.at.length > depth) {
            found.add(entry.at[depth]!)
          }
        }
      }

      if (found.size === 0) {
        return reached ? [0] : []
      }

      return [...found].sort((a, b) => a - b)
    },
  }
}

function typed(value: string, type: string): JsonContent {
  if ((type === 'number' || type === 'integer') && value.trim() !== '' && !isNaN(Number(value))) {
    return Number(value)
  }

  if (type === 'boolean' && (value === 'true' || value === 'false')) {
    return value === 'true'
  }

  return value
}

function jsonNode(
  node: DocumentStructureNode,
  values: DocumentValues,
  at: ReadonlyArray<number>,
): JsonContent | undefined {
  switch (node.kind) {
    case 'field': {
      const value = values.get(node.path, at)

      return value === undefined ? undefined : typed(value, node.type)
    }

    case 'object': {
      const object = jsonObject(node.children, values, at)

      return Object.keys(object).length > 0 ? object : undefined
    }

    case 'array': {
      const items = values
        .repetitions(node.path, at)
        .map((index) => jsonNode(node.items, values, [...at, index]))
        .filter((item) => item !== undefined)

      return items.length > 0 ? items : undefined
    }
  }
}

function jsonObject(
  nodes: ReadonlyArray<DocumentStructureNode>,
  values: DocumentValues,
  at: ReadonlyArray<number>,
) {
  const object: Record<string, JsonContent> = {}

  for (const node of nodes) {
    const value = jsonNode(node, values, at)

    if (value !== undefined) {
      object[node.name] = value
    }
  }

  return object
}

export function renderJson(
  structure: Pick<DocumentStructure, 'children'>,
  values: DocumentValues,
): JsonContent {
  return jsonObject(structure.children, values, [])
}

const escapeEdifact = (value: string) => value.replaceAll(/([?+:'])/g, '?$1')

function trimmedJoin(parts: ReadonlyArray<string>, separator: string) {
  const end = parts.findLastIndex((part) => part !== '')

  return parts.slice(0, end + 1).join(separator)
}

// The service segments frame every Message, whatever the Mapping fills.
const framingTags = new Set(['UNH', 'UNS', 'UNT'])

const dateFormats = new Map([
  [8, '102'],
  [12, '203'],
])

function segmentLines(
  nodes: ReadonlyArray<EdifactStructureNode>,
  values: DocumentValues,
  at: ReadonlyArray<number>,
  lines: string[],
) {
  for (const node of nodes) {
    if (node.kind === 'segmentGroup') {
      const repeats = node.maxRepeat > 1

      for (const index of repeats ? values.repetitions(node.path, at) : [0]) {
        if (repeats || values.repetitions(node.path, at).length > 0) {
          segmentLines(node.children, values, repeats ? [...at, index] : at, lines)
        }
      }

      continue
    }

    let filled = false

    const valueOf = (path: string, codes: ReadonlyArray<{ code: string }>) => {
      const value = values.get(path, at)

      if (value !== undefined && value !== '') {
        filled = true

        return value
      }

      return codes.length === 1 ? codes[0]!.code : ''
    }

    const elements = node.children.map((child) => {
      if (child.kind === 'element') {
        return escapeEdifact(valueOf(child.path, child.codes))
      }

      const components = child.children.map((element) => valueOf(element.path, element.codes))
      const date = child.children.findIndex(({ code }) => code === '2380')
      const format = child.children.findIndex(({ code }) => code === '2379')

      if (date >= 0 && format >= 0 && components[format] === '') {
        components[format] = dateFormats.get(components[date]!.length) ?? ''
      }

      return trimmedJoin(components.map(escapeEdifact), ':')
    })

    if (node.tag === 'UNT') {
      elements[0] = String(lines.length + 1)
    }

    if (filled || framingTags.has(node.tag)) {
      const data = trimmedJoin(elements, '+')

      lines.push(`${node.tag}${data === '' ? '' : `+${data}`}'`)
    }
  }
}

// One segment per line, from UNH to UNT; the envelope is up to the Channel and Trading Partner.
export function renderEdifact(
  structure: Pick<MessageTypeStructure, 'children'>,
  values: DocumentValues,
  messageReference = '1',
) {
  const framed = documentValues([
    ...['UNH/0062', 'UNT/0062'].map((path) => ({ path, at: [], value: messageReference })),
  ])

  const merged: DocumentValues = {
    get: (path, at) => values.get(path, at) ?? framed.get(path, at),
    entries: values.entries,
    beneath: values.beneath,
    repetitions: values.repetitions,
  }

  const lines: string[] = []

  segmentLines(structure.children, merged, [], lines)

  return lines.join('\n')
}
