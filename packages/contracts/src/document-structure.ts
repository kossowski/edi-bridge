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
