import { z } from 'zod'

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

export type DocumentObject = {
  kind: 'object'
  path: string
  name: string
  required: boolean
  children: DocumentStructureNode[]
}

export type DocumentArray = {
  kind: 'array'
  path: string
  name: string
  required: boolean
  items: DocumentField | DocumentObject
}

export type DocumentStructureNode = DocumentField | DocumentObject | DocumentArray

export const documentObjectSchema: z.ZodType<DocumentObject> = z.object({
  ...node,
  kind: z.literal('object'),
  get children() {
    return z.array(documentStructureNodeSchema)
  },
})

export const documentArraySchema: z.ZodType<DocumentArray> = z.object({
  ...node,
  kind: z.literal('array'),
  get items() {
    return z.union([documentFieldSchema, documentObjectSchema])
  },
})

export const documentStructureNodeSchema: z.ZodType<DocumentStructureNode> = z.union([
  documentFieldSchema,
  documentObjectSchema,
  documentArraySchema,
])

export const documentStructureSchema = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1).max(70),
  format: documentFormatSchema,
  children: z.array(documentStructureNodeSchema).min(1),
})

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
