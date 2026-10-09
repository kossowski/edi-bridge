export type FormIssue = { code: string; path: PropertyKey[] }

export function fieldErrors<Field extends string, Error>(
  issues: ReadonlyArray<FormIssue>,
  fields: ReadonlyArray<Field>,
  errorOf: (field: Field, issue: FormIssue) => Error,
): Partial<Record<Field, Error>> {
  const errors: Partial<Record<Field, Error>> = {}

  for (const issue of issues) {
    const field = fields.find((candidate) => candidate === issue.path[0])

    if (field !== undefined) {
      errors[field] ??= errorOf(field, issue)
    }
  }

  return errors
}

export function tooLongOr<Error>(issue: FormIssue, otherwise: Error): Error | 'tooLong' {
  return issue.code === 'too_big' ? 'tooLong' : otherwise
}
