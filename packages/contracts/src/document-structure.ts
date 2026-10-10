import { z } from 'zod'

import { mappingVersionSummarySchema } from './mapping-version'

import type { Endpoint } from './endpoint'

export const documentFormats = ['json', 'csv'] as const

export const documentFormatSchema = z.enum(documentFormats)

export type DocumentFormat = z.infer<typeof documentFormatSchema>

export const documentFieldTypes = ['string', 'number', 'integer', 'boolean', 'date'] as const

export const documentFieldTypeSchema = z.enum(documentFieldTypes)

export type DocumentFieldType = z.infer<typeof documentFieldTypeSchema>

// Every node carries its path, e.g. `lines[].gtin`, which Mapping links point at. An array's
// items share the array's path.
const node = {
  path: z.string().min(1),
  name: z.string().min(1),
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

    if (node.kind === 'array') {
      if (node.items.path !== node.path) {
        problems.push(`The items of ${node.path} must share its path`)
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

const structureName = z.string().trim().min(1).max(70)

const treeFields = { children: z.array(documentStructureNodeSchema).min(1) }

const formatFields = {
  json: { format: z.literal('json'), root: jsonRootSchema },
  csv: { format: z.literal('csv'), csv: csvSettingsSchema },
}

export const inferredDocumentStructureSchema = z
  .discriminatedUnion('format', [
    z.object({ ...formatFields.json, ...treeFields }),
    z.object({ ...formatFields.csv, ...treeFields }),
  ])
  .superRefine(checkTree)

export type InferredDocumentStructure = z.infer<typeof inferredDocumentStructureSchema>

const identityFields = { id: z.uuid(), name: structureName }

export const documentStructureSchema = z
  .discriminatedUnion('format', [
    z.object({ ...identityFields, ...formatFields.json, ...treeFields }),
    z.object({ ...identityFields, ...formatFields.csv, ...treeFields }),
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

export const documentStructureSummarySchema = z.object({
  id: z.uuid(),
  name: structureName,
  format: documentFormatSchema,
  fieldCount: z.number().int().min(0),
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
  fileName: z.string().trim().min(1).max(255),
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

export const inferDocumentStructureEndpoint: Endpoint<
  InferredDocumentStructure,
  undefined,
  DocumentStructureOrigin
> = {
  method: 'POST',
  path: '/document-structures/inference',
  body: documentStructureOriginSchema,
  response: inferredDocumentStructureSchema,
}

export const createDocumentStructureBodySchema = z.object({
  name: structureName,
  origin: documentStructureOriginSchema,
})

export type CreateDocumentStructureBody = z.infer<typeof createDocumentStructureBodySchema>

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
  })
  .refine(
    ({ required, repeating, type }) =>
      required !== undefined || repeating !== undefined || type !== undefined,
    { message: 'An adjustment changes at least one property' },
  )

export type NodeAdjustment = z.infer<typeof nodeAdjustmentSchema>

export const updateDocumentStructureBodySchema = z.object({
  name: structureName,
  csv: csvSettingsSchema.optional(),
  document: encodedFileSchema.optional(),
  adjustments: z
    .array(nodeAdjustmentSchema)
    .refine(
      (adjustments) => new Set(adjustments.map(({ path }) => path)).size === adjustments.length,
      {
        message: 'Each node is adjusted once',
      },
    ),
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
