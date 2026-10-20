import {
  type CsvSettings,
  type DocumentStructureNode,
  documentStructureNodes,
  type DocumentStructureOriginKind,
  type EncodedFile,
  type FieldLabelChoice,
  type FieldNamesNotice,
  type InferredDocumentStructure,
  type JsonContent,
  jsonContentSchema,
} from '@edi-bridge/contracts'

import { splitRows } from './csv-text'
import { decodeBase64 } from './document-file'

export type LabelChoices = ReadonlyMap<string, string>

export type ChosenFile = { file: EncodedFile; kind: DocumentStructureOriginKind }

export function isBlank(text: string) {
  return text.trim() === ''
}

export function labelsToCheck(
  children: ReadonlyArray<DocumentStructureNode>,
  choices: LabelChoices,
): DocumentStructureNode[] {
  return [...documentStructureNodes(children)].flatMap(({ node }) =>
    node.labelUnsure && !choices.has(node.path) ? [node] : [],
  )
}

export function unsureLabelCount(children: ReadonlyArray<DocumentStructureNode>) {
  return [...documentStructureNodes(children)].filter(({ node }) => node.labelUnsure).length
}

function labelsByPath(children: ReadonlyArray<DocumentStructureNode>) {
  return new Map([...documentStructureNodes(children)].map(({ node }) => [node.path, node.label]))
}

export function keptChoices(
  choices: LabelChoices,
  previous: ReadonlyArray<DocumentStructureNode>,
  next: ReadonlyArray<DocumentStructureNode>,
): LabelChoices {
  const before = labelsByPath(previous)
  const after = labelsByPath(next)

  return new Map(
    [...choices].filter(([path, label]) => {
      const nextLabel = after.get(path)

      if (nextLabel === undefined) {
        return false
      }

      return before.get(path) !== label || nextLabel === label
    }),
  )
}

type NamedTree = {
  children: ReadonlyArray<DocumentStructureNode>
  fieldNamesNotice: FieldNamesNotice | null
}

export function labelsToSave(
  { children, fieldNamesNotice }: NamedTree,
  choices: LabelChoices,
): FieldLabelChoice[] {
  if (fieldNamesNotice !== null) {
    return [...choices].map(([path, label]) => ({ path, label }))
  }

  return [...documentStructureNodes(children)].map(({ node }) => {
    const label = choices.get(node.path) ?? node.label

    return { path: node.path, label, labelReason: label === node.label ? node.labelReason : null }
  })
}

export type FileFacts =
  | { format: 'csv'; columnCount: number; rowCount: number }
  | { format: 'json'; fieldCount: number }

function parsedJson(text: string): JsonContent | undefined {
  try {
    return jsonContentSchema.parse(JSON.parse(text))
  } catch {
    return undefined
  }
}

function recordOf(value: JsonContent) {
  if (Array.isArray(value) || !(value instanceof Object)) {
    return undefined
  }

  return value
}

function valueFieldCount(values: ReadonlyArray<JsonContent>): number {
  const records = values.flatMap((value) => {
    const record = recordOf(value)

    return record === undefined ? [] : [record]
  })

  if (records.length > 0) {
    const byKey = new Map<string, JsonContent[]>()

    for (const record of records) {
      for (const [key, value] of Object.entries(record)) {
        byKey.set(key, [...(byKey.get(key) ?? []), value])
      }
    }

    return [...byKey.values()].reduce((sum, list) => sum + valueFieldCount(list), 0)
  }

  const lists = values.flatMap((value) => (Array.isArray(value) ? [value] : []))

  return lists.length > 0 ? valueFieldCount(lists.flat()) : 1
}

function schemaFieldCount(schema: JsonContent): number {
  const record = recordOf(schema)

  if (record === undefined) {
    return 1
  }

  const { properties, items } = record
  const described = properties === undefined ? undefined : recordOf(properties)

  if (described !== undefined) {
    return Object.values(described).reduce<number>(
      (sum, property) => sum + schemaFieldCount(property),
      0,
    )
  }

  return items === undefined ? 1 : schemaFieldCount(items)
}

function csvFacts(text: string, { delimiter, headerRow }: CsvSettings): FileFacts | null {
  const rows = splitRows(text, delimiter, Infinity)
  const [first] = rows

  if (first === undefined) {
    return null
  }

  return {
    format: 'csv',
    columnCount: headerRow ? first.length : Math.max(...rows.map((cells) => cells.length)),
    rowCount: headerRow ? rows.length - 1 : rows.length,
  }
}

export function fileFacts(
  kind: DocumentStructureOriginKind,
  file: EncodedFile,
  csv: CsvSettings,
): FileFacts | null {
  const encoding = kind === 'csvDocument' ? csv.encoding : 'utf-8'
  const text = new TextDecoder(encoding).decode(decodeBase64(file.content))

  if (kind === 'csvDocument') {
    return csvFacts(text, csv)
  }

  const parsed = parsedJson(text)

  if (parsed === undefined) {
    return null
  }

  return {
    format: 'json',
    fieldCount: kind === 'jsonSchema' ? schemaFieldCount(parsed) : valueFieldCount([parsed]),
  }
}

export function inferredFacts(inferred: InferredDocumentStructure): FileFacts {
  return inferred.format === 'csv'
    ? { format: 'csv', ...inferred.facts }
    : { format: 'json', ...inferred.facts }
}

export type ReadProgress = 'opening' | 'finding' | 'naming' | 'read'

export function readProgress({
  chosen,
  facts,
  inferred,
}: {
  chosen: ChosenFile | null
  facts: FileFacts | null
  inferred: InferredDocumentStructure | null
}): ReadProgress {
  if (chosen === null) {
    return 'opening'
  }

  if (inferred !== null) {
    return 'read'
  }

  return facts === null ? 'finding' : 'naming'
}

const readingStepKeys = ['opening', 'finding', 'naming'] as const

export type ReadingStepKey = (typeof readingStepKeys)[number]

export type ReadingStepState = 'done' | 'active' | 'pending'

const activeStepOf = { opening: 0, finding: 1, naming: 2, read: readingStepKeys.length } as const

function stepState(index: number, active: number): ReadingStepState {
  if (index < active) {
    return 'done'
  }

  return index === active ? 'active' : 'pending'
}

export function readingSteps(
  progress: ReadProgress,
): Array<{ key: ReadingStepKey; state: ReadingStepState }> {
  const active = activeStepOf[progress]

  return readingStepKeys.map((key, index) => ({ key, state: stepState(index, active) }))
}

export type SaveBlock = { reason: 'labels'; count: number } | { reason: 'name' }

export function saveBlock(toCheck: number, name: string): SaveBlock | null {
  if (toCheck > 0) {
    return { reason: 'labels', count: toCheck }
  }

  return isBlank(name) ? { reason: 'name' } : null
}
