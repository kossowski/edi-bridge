import type { z } from 'zod'

type QueryValue = string | number | boolean | ReadonlyArray<string | number | boolean> | undefined

export type QueryParams = Readonly<Record<string, QueryValue>>

export type PathParams<Path extends string> = Path extends `${string}:${infer Name}/${infer Rest}`
  ? { readonly [Key in Name]: string } & PathParams<`/${Rest}`>
  : Path extends `${string}:${infer Name}`
    ? { readonly [Key in Name]: string }
    : Record<never, never>

export type Endpoint<
  Response,
  Query extends QueryParams | undefined = undefined,
  Body = undefined,
  Path extends string = string,
> = {
  method: 'GET' | 'POST'
  path: Path
  response: z.ZodType<Response>
} & (Query extends QueryParams ? { query: z.ZodType<Query, unknown> } : { query?: undefined }) &
  (Body extends undefined ? { body?: undefined } : { body: z.ZodType<Body> })

export function toPath<Path extends string>(path: Path, params: PathParams<Path>): string {
  const values: Readonly<Record<string, string>> = params

  return path.replaceAll(/:(\w+)/g, (_, name: string) => {
    const value = values[name]

    if (value === undefined) {
      throw new Error(`Missing path parameter "${name}" for ${path}`)
    }

    return encodeURIComponent(value)
  })
}

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
