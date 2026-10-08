import type { z } from 'zod'

export interface Endpoint<Response, Query = undefined> {
  method: 'GET'
  path: string
  query?: z.ZodType<Query, unknown>
  response: z.ZodType<Response>
}

type QueryValue = string | number | boolean | ReadonlyArray<string | number | boolean> | undefined

export type QueryParams = Readonly<Record<string, QueryValue>>

export function toSearchParams(query: QueryParams): URLSearchParams {
  const params = new URLSearchParams()

  for (const [key, value] of Object.entries(query)) {
    for (const item of [value].flat()) {
      if (item !== undefined) {
        params.append(key, String(item))
      }
    }
  }

  return params
}

export function fromSearchParams(params: URLSearchParams) {
  return Object.fromEntries(
    [...new Set(params.keys())].map((key) => {
      const values = params.getAll(key)

      return [key, values.length === 1 ? values[0] : values]
    }),
  )
}
