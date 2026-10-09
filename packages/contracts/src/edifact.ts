import { z } from 'zod'

export const controlReferenceSchema = z.string().min(1).max(14)

export const segmentTagSchema = z.string().regex(/^[A-Z0-9]{3}$/)

export const localizedTextSchema = z.object({
  en: z.string().min(1),
  de: z.string().min(1),
})

export type LocalizedText = z.infer<typeof localizedTextSchema>

export const edifactCodeSchema = z.object({
  code: z.string().min(1).max(17),
  meaning: localizedTextSchema,
})

export type EdifactCode = z.infer<typeof edifactCodeSchema>

// Every node carries its path, e.g. `SG2/NAD+BY/C082/3039`, which Mapping links point at.
const structureNode = {
  path: z.string().min(1),
  name: localizedTextSchema,
  required: z.boolean(),
}

export const edifactElementSchema = z.object({
  ...structureNode,
  kind: z.literal('element'),
  code: z.string().regex(/^\d{4}$/),
  format: z.string().regex(/^(a|n|an)(\.\.)?\d+$/),
  codes: z.array(edifactCodeSchema),
})

export type EdifactElement = z.infer<typeof edifactElementSchema>

export const edifactCompositeSchema = z.object({
  ...structureNode,
  kind: z.literal('composite'),
  code: z.string().regex(/^[CS]\d{3}$/),
  children: z.array(edifactElementSchema).min(1),
})

export type EdifactComposite = z.infer<typeof edifactCompositeSchema>

const maxRepeatSchema = z.number().int().min(1)

// A segment used with one fixed qualifier, e.g. DTM+137, is its own node, so a link can target
// the document date without also matching the delivery date.
export const edifactSegmentSchema = z.object({
  ...structureNode,
  kind: z.literal('segment'),
  tag: segmentTagSchema,
  qualifier: edifactCodeSchema.nullable(),
  maxRepeat: maxRepeatSchema,
  children: z.array(z.discriminatedUnion('kind', [edifactCompositeSchema, edifactElementSchema])),
})

export type EdifactSegment = z.infer<typeof edifactSegmentSchema>

export type EdifactSegmentGroup = {
  kind: 'segmentGroup'
  path: string
  code: string
  name: LocalizedText
  required: boolean
  maxRepeat: number
  children: EdifactStructureNode[]
}

export const edifactSegmentGroupSchema: z.ZodType<EdifactSegmentGroup> = z.object({
  ...structureNode,
  kind: z.literal('segmentGroup'),
  code: z.string().regex(/^SG\d{1,2}$/),
  maxRepeat: maxRepeatSchema,
  get children() {
    return z.array(edifactStructureNodeSchema)
  },
})

export type EdifactStructureNode = EdifactSegment | EdifactSegmentGroup

export const edifactStructureNodeSchema: z.ZodType<EdifactStructureNode> = z.union([
  edifactSegmentSchema,
  edifactSegmentGroupSchema,
])
