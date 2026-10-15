export type Values = ReadonlyMap<string, string>

export const isBeneath = (path: string, part: string, separator = '/') =>
  path === part || path.startsWith(`${part}${separator}`)

type Part = { path: string; required: boolean }

export const hasValueBeneath = ({ path }: Part, values: Values, separator = '/') =>
  [...values.keys()].some((target) => isBeneath(target, path, separator))

export const isRequiredOrFilled = (part: Part, values: Values, separator = '/') =>
  part.required || hasValueBeneath(part, values, separator)

export function setFilled(values: Map<string, string>, path: string, value: string | undefined) {
  if (value !== undefined && value !== '') {
    values.set(path, value)
  }
}
