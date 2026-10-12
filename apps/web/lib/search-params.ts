export function firstSearchParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

export type SearchParamsReader = { get: (name: string) => string | null }

export const listPageSize = 50

const pagePattern = /^[1-9]\d{0,5}$/

export function parsePage(params: SearchParamsReader) {
  const page = params.get('page') ?? ''

  return pagePattern.test(page) ? Number(page) : 1
}

export function setPage(params: URLSearchParams, page: number) {
  if (page > 1) {
    params.set('page', String(page))
  }
}
