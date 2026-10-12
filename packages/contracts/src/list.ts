import { z } from 'zod'

export function many<Item extends z.ZodType>(item: Item) {
  return z.preprocess(
    (value) => (value === undefined ? undefined : [value].flat()),
    z.array(item).optional(),
  )
}

export const listQueryFields = {
  q: z.string().trim().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
}

export const listPageFields = {
  total: z.number().int().min(0),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
}
