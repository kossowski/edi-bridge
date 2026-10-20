import { z } from 'zod'

import { mappingVersionSummarySchema } from './mapping-version'

import type { Endpoint } from './endpoint'

export const documentFormats = ['json', 'csv'] as const

export const documentFormatSchema = z.enum(documentFormats)

export type DocumentFormat = z.infer<typeof documentFormatSchema>

export const documentFieldTypes = ['string', 'number', 'integer', 'boolean', 'date'] as const

export const documentFieldTypeSchema = z.enum(documentFieldTypes)

export type DocumentFieldType = z.infer<typeof documentFieldTypeSchema>

export const maxFieldLabelLength = 70

export const fieldLabelSchema = z.string().trim().min(1).max(maxFieldLabelLength)

// Every node carries its path, e.g. `lines[].gtin`, which Mapping links point at, and a plain name
// (`label`) with the reason it was chosen, or no reason when a person named it by hand. An array's
// items share the array's path and plain name.
const node = {
  path: z.string().min(1),
  name: z.string().min(1),
  label: fieldLabelSchema,
  labelReason: z.string().trim().min(1).nullable(),
  labelUnsure: z.boolean(),
  required: z.boolean(),
}

export const documentFieldSchema = z.object({
  ...node,
  kind: z.literal('field'),
  type: documentFieldTypeSchema,
})

export type DocumentField = z.infer<typeof documentFieldSchema>

// The recursive schemas list the node fields one by one: spreading them in breaks TypeScript's
// inference of the getter.
export const documentObjectSchema = z.object({
  path: node.path,
  name: node.name,
  label: node.label,
  labelReason: node.labelReason,
  labelUnsure: node.labelUnsure,
  required: node.required,
  kind: z.literal('object'),
  get children(): z.ZodArray<
    z.ZodUnion<
      [typeof documentFieldSchema, typeof documentObjectSchema, typeof documentArraySchema]
    >
  > {
    return z.array(z.union([documentFieldSchema, documentObjectSchema, documentArraySchema]))
  },
})

export type DocumentObject = z.infer<typeof documentObjectSchema>

export const documentArraySchema = z.object({
  path: node.path,
  name: node.name,
  label: node.label,
  labelReason: node.labelReason,
  labelUnsure: node.labelUnsure,
  required: node.required,
  kind: z.literal('array'),
  get items(): z.ZodUnion<[typeof documentFieldSchema, typeof documentObjectSchema]> {
    return z.union([documentFieldSchema, documentObjectSchema])
  },
})

export type DocumentArray = z.infer<typeof documentArraySchema>

export const documentStructureNodeSchema = z.union([
  documentFieldSchema,
  documentObjectSchema,
  documentArraySchema,
])

export type DocumentStructureNode = z.infer<typeof documentStructureNodeSchema>

export const characterEncodings = ['utf-8', 'windows-1252'] as const

export const characterEncodingSchema = z.enum(characterEncodings)

export type CharacterEncoding = z.infer<typeof characterEncodingSchema>

export const csvDelimiters = [',', ';', '\t', '|'] as const

export const csvDelimiterSchema = z.enum(csvDelimiters)

export type CsvDelimiter = z.infer<typeof csvDelimiterSchema>

export const csvSettingsSchema = z.object({
  delimiter: csvDelimiterSchema,
  headerRow: z.boolean(),
  encoding: characterEncodingSchema,
})

export type CsvSettings = z.infer<typeof csvSettingsSchema>

export const defaultCsvSettings: CsvSettings = {
  delimiter: ';',
  headerRow: true,
  encoding: 'utf-8',
}

export function childPath(parentPath: string, segment: string) {
  return parentPath === '' ? segment : `${parentPath}.${segment}`
}

export function arrayPath(path: string) {
  return `${path}[]`
}

export function arrayBasePath(path: string) {
  return path.endsWith('[]') ? path.slice(0, -2) : path
}

// A CSV Document is a list of rows, so its tree is one repeating `rows` object of column fields. A
// JSON Document that is a list at the top level gets the same shape under `items`.
export const csvRowsName = 'rows'

export const csvRowsPath = arrayPath(csvRowsName)

export const jsonItemsName = 'items'

export const jsonItemsPath = arrayPath(jsonItemsName)

export const jsonRoots = ['object', 'array'] as const

export const jsonRootSchema = z.enum(jsonRoots)

export type JsonRoot = z.infer<typeof jsonRootSchema>

export function nodeContent(node: DocumentStructureNode): DocumentField | DocumentObject {
  return node.kind === 'array' ? node.items : node
}

export type VisitedNode = {
  node: DocumentStructureNode
  ancestors: ReadonlyArray<DocumentStructureNode>
}

export function* documentStructureNodes(
  nodes: ReadonlyArray<DocumentStructureNode>,
  ancestors: ReadonlyArray<DocumentStructureNode> = [],
): Generator<VisitedNode> {
  for (const node of nodes) {
    yield { node, ancestors }

    const content = nodeContent(node)

    if (content.kind === 'object') {
      yield* documentStructureNodes(content.children, [...ancestors, node])
    }
  }
}

type DocumentTree =
  | { format: 'json'; root: JsonRoot; children: ReadonlyArray<DocumentStructureNode> }
  | { format: 'csv'; children: ReadonlyArray<DocumentStructureNode> }

function rootList(children: ReadonlyArray<DocumentStructureNode>, path: string) {
  const [list, ...rest] = children

  return list?.kind === 'array' && list.path === path && rest.length === 0 ? list : undefined
}

function treeProblems(tree: DocumentTree): string[] {
  const problems: string[] = []
  const paths = new Set<string>()

  for (const { node } of documentStructureNodes(tree.children)) {
    if (paths.has(node.path)) {
      problems.push(`The path ${node.path} is used twice`)
    }

    paths.add(node.path)

    if (node.labelReason === null && node.labelUnsure) {
      problems.push(`The plain name of ${node.path} was given by hand, so it cannot be unsure`)
    }

    if (node.kind === 'array') {
      if (node.items.path !== node.path) {
        problems.push(`The items of ${node.path} must share its path`)
      }

      if (
        node.items.label !== node.label ||
        node.items.labelReason !== node.labelReason ||
        node.items.labelUnsure !== node.labelUnsure
      ) {
        problems.push(`The items of ${node.path} must share its plain name`)
      }

      if (!node.items.required) {
        problems.push(`The items of ${node.path} must be required`)
      }
    }
  }

  if (tree.format === 'csv') {
    const rows = rootList(tree.children, csvRowsPath)

    if (rows?.items.kind !== 'object' || rows.items.children.some(({ kind }) => kind !== 'field')) {
      problems.push(`A CSV Document Structure must be one ${csvRowsPath} object of column fields`)
    }
  } else if (tree.root === 'array' && !rootList(tree.children, jsonItemsPath)) {
    problems.push(`A JSON Document Structure of a list must be one ${jsonItemsPath} list`)
  }

  return problems
}

function checkTree(tree: DocumentTree, context: z.RefinementCtx) {
  for (const message of treeProblems(tree)) {
    context.addIssue({ code: 'custom', message, path: ['children'] })
  }
}

export const maxDocumentStructureNameLength = 70

const structureName = z.string().trim().min(1).max(maxDocumentStructureNameLength)

const treeFields = { children: z.array(documentStructureNodeSchema).min(1) }

const formatFields = {
  json: { format: z.literal('json'), root: jsonRootSchema },
  csv: { format: z.literal('csv'), csv: csvSettingsSchema },
}

const fileNameSchema = z.string().trim().min(1).max(255)

// The decoded text of the sample Document a structure was read from. A structure created from a
// JSON Schema has none.
export const documentStructureSampleSchema = z.object({
  fileName: fileNameSchema,
  text: z.string().min(1),
  takenAt: z.iso.datetime(),
})

export type DocumentStructureSample = z.infer<typeof documentStructureSampleSchema>

const sampleFields = { sample: documentStructureSampleSchema.nullable() }

const count = z.number().int().min(0)

const factFields = {
  json: { facts: z.object({ fieldCount: count }) },
  csv: { facts: z.object({ columnCount: count, rowCount: count }) },
}

export const inferredDocumentStructureSchema = z
  .discriminatedUnion('format', [
    z.object({ ...formatFields.json, ...factFields.json, ...sampleFields, ...treeFields }),
    z.object({ ...formatFields.csv, ...factFields.csv, ...sampleFields, ...treeFields }),
  ])
  .superRefine(checkTree)

export type InferredDocumentStructure = z.infer<typeof inferredDocumentStructureSchema>

const identityFields = { id: z.uuid(), name: structureName }

export const documentStructureSchema = z
  .discriminatedUnion('format', [
    z.object({ ...identityFields, ...formatFields.json, ...sampleFields, ...treeFields }),
    z.object({ ...identityFields, ...formatFields.csv, ...sampleFields, ...treeFields }),
  ])
  .superRefine(checkTree)

export type DocumentStructure = z.infer<typeof documentStructureSchema>

export const documentStructureEndpoint: Endpoint<
  DocumentStructure,
  undefined,
  undefined,
  '/document-structures/:id'
> = {
  method: 'GET',
  path: '/document-structures/:id',
  response: documentStructureSchema,
}

export const samplePreviewLineCount = 7

export function samplePreview(text: string) {
  return text.split(/\r?\n/).slice(0, samplePreviewLineCount).join('\n')
}

export const summaryFieldLabelCount = 3

export const documentStructureSummarySchema = z.object({
  id: z.uuid(),
  name: structureName,
  format: documentFormatSchema,
  fieldCount: count,
  firstFieldLabels: z.array(fieldLabelSchema).max(summaryFieldLabelCount),
  sample: documentStructureSampleSchema
    .omit({ text: true })
    .extend({ preview: z.string() })
    .nullable(),
  mappings: z.array(z.object({ id: z.uuid(), name: z.string().min(1) })),
})

export type DocumentStructureSummary = z.infer<typeof documentStructureSummarySchema>

export const documentStructuresEndpoint: Endpoint<DocumentStructureSummary[]> = {
  method: 'GET',
  path: '/document-structures',
  response: z.array(documentStructureSummarySchema),
}

export const maxEncodedFileBytes = 5_000_000

// Base64 keeps the raw bytes, so a Windows-1252 Document is decoded only once its encoding is known.
export const encodedFileSchema = z.object({
  fileName: fileNameSchema,
  content: z
    .base64()
    .min(1)
    .max(Math.ceil(maxEncodedFileBytes / 3) * 4),
})

export type EncodedFile = z.infer<typeof encodedFileSchema>

export const documentStructureOriginKinds = ['jsonDocument', 'csvDocument', 'jsonSchema'] as const

export type DocumentStructureOriginKind = (typeof documentStructureOriginKinds)[number]

export const documentStructureOriginSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('jsonDocument'), document: encodedFileSchema }),
  z.object({ kind: z.literal('csvDocument'), document: encodedFileSchema, csv: csvSettingsSchema }),
  z.object({ kind: z.literal('jsonSchema'), jsonSchema: encodedFileSchema }),
])

export type DocumentStructureOrigin = z.infer<typeof documentStructureOriginSchema>

export const fieldNamesNoticeReasons = ['aiBudgetExhausted', 'aiUnavailable'] as const

export const fieldNamesNoticeSchema = z.object({
  reason: z.enum(fieldNamesNoticeReasons),
  message: z.string().min(1),
})

export type FieldNamesNotice = z.infer<typeof fieldNamesNoticeSchema>

export type FieldNamesNoticeReason = FieldNamesNotice['reason']

export const fieldNamesNotices = {
  aiBudgetExhausted: {
    reason: 'aiBudgetExhausted',
    message: 'AI budget used up for today; fields named without AI',
  },
  aiUnavailable: { reason: 'aiUnavailable', message: 'AI unavailable; fields named without AI' },
} as const satisfies Record<FieldNamesNoticeReason, FieldNamesNotice>

export const documentStructureInferenceSchema = z.intersection(
  inferredDocumentStructureSchema,
  z.object({ fieldNamesNotice: fieldNamesNoticeSchema.nullable() }),
)

export type DocumentStructureInference = z.infer<typeof documentStructureInferenceSchema>

export const inferDocumentStructureEndpoint: Endpoint<
  DocumentStructureInference,
  undefined,
  DocumentStructureOrigin
> = {
  method: 'POST',
  path: '/document-structures/inference',
  body: documentStructureOriginSchema,
  response: documentStructureInferenceSchema,
}

function onePerPath(entries: ReadonlyArray<{ path: string }>) {
  return new Set(entries.map(({ path }) => path)).size === entries.length
}

// A null reason marks a name chosen by hand. A chosen name is never unsure.
export const fieldLabelChoiceSchema = z.object({
  path: z.string().min(1),
  label: fieldLabelSchema,
  labelReason: z.string().trim().min(1).nullable().default(null),
})

export type FieldLabelChoice = z.input<typeof fieldLabelChoiceSchema>

export const createDocumentStructureBodySchema = z.object({
  name: structureName,
  origin: documentStructureOriginSchema,
  labels: z
    .array(fieldLabelChoiceSchema)
    .refine(onePerPath, { message: 'Each node is named once' })
    .optional(),
})

export type CreateDocumentStructureBody = z.input<typeof createDocumentStructureBodySchema>

export const createDocumentStructureEndpoint: Endpoint<
  DocumentStructure,
  undefined,
  CreateDocumentStructureBody
> = {
  method: 'POST',
  path: '/document-structures',
  body: createDocumentStructureBodySchema,
  response: documentStructureSchema,
}

// Paths name nodes as the stored structure has them, so turning an object into an array and
// adjusting its fields in the same update still addresses the fields by their old paths. With a
// CSV Document in the update, they name nodes as that Document infers them.
export const nodeAdjustmentSchema = z
  .object({
    path: z.string().min(1),
    required: z.boolean().optional(),
    repeating: z.boolean().optional(),
    type: documentFieldTypeSchema.optional(),
    label: fieldLabelSchema.optional(),
  })
  .refine(
    ({ required, repeating, type, label }) =>
      required !== undefined ||
      repeating !== undefined ||
      type !== undefined ||
      label !== undefined,
    { message: 'An adjustment changes at least one property' },
  )

export type NodeAdjustment = z.infer<typeof nodeAdjustmentSchema>

export const updateDocumentStructureBodySchema = z.object({
  name: structureName,
  csv: csvSettingsSchema.optional(),
  document: encodedFileSchema.optional(),
  adjustments: z
    .array(nodeAdjustmentSchema)
    .refine(onePerPath, { message: 'Each node is adjusted once' }),
})

export type UpdateDocumentStructureBody = z.infer<typeof updateDocumentStructureBodySchema>

export const updateDocumentStructureEndpoint: Endpoint<
  DocumentStructure,
  undefined,
  UpdateDocumentStructureBody,
  '/document-structures/:id'
> = {
  method: 'PUT',
  path: '/document-structures/:id',
  body: updateDocumentStructureBodySchema,
  response: documentStructureSchema,
}

export const documentStructureProblemCodes = [
  'unreadableContent',
  'invalidJson',
  'invalidCsv',
  'invalidJsonSchema',
  'unsupportedJson',
  'unsupportedJsonSchema',
  'emptyDocument',
  'inconsistentCsvRows',
  'unknownPath',
  'notAdjustable',
  'csvDocumentRequired',
  'linkedByMapping',
  'usedByMappingVersion',
] as const

export const documentStructureProblemCodeSchema = z.enum(documentStructureProblemCodes)

export type DocumentStructureProblemCode = z.infer<typeof documentStructureProblemCodeSchema>

export const documentStructureProblemSchema = z
  .object({
    code: documentStructureProblemCodeSchema,
    message: z.string().min(1),
    path: z.string().min(1).nullable(),
    line: z.number().int().min(1).nullable(),
    mappingVersions: z.array(mappingVersionSummarySchema).min(1).nullable(),
  })
  .refine(
    ({ code, mappingVersions }) => (code === 'usedByMappingVersion') === (mappingVersions !== null),
    {
      message: 'Only a usedByMappingVersion problem names Mapping Versions',
      path: ['mappingVersions'],
    },
  )

export type DocumentStructureProblem = z.infer<typeof documentStructureProblemSchema>
