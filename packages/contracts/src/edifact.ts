import { z } from 'zod'

export const controlReferenceSchema = z.string().min(1).max(14)

export const segmentTagSchema = z.string().regex(/^[A-Z0-9]{3}$/)
