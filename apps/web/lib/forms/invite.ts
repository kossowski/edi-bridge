import { type AcceptInviteInput, acceptInviteInputSchema } from '@edi-bridge/contracts'

import { type FormIssue, tooLongOr } from './field-errors'

export type AcceptInviteErrors = {
  name?: 'required' | 'tooLong'
  password?: 'required' | 'tooShort' | 'tooLong'
}

function issueOf(issues: ReadonlyArray<FormIssue>, field: keyof AcceptInviteInput) {
  return issues.find((issue) => issue.path[0] === field)
}

export function validateAcceptInviteForm(
  values: AcceptInviteInput,
): { input: AcceptInviteInput } | { error: AcceptInviteErrors } {
  const parsed = acceptInviteInputSchema.safeParse(values)

  if (parsed.success) {
    return { input: parsed.data }
  }

  const name = issueOf(parsed.error.issues, 'name')
  const password = issueOf(parsed.error.issues, 'password')

  return {
    error: {
      ...(name && { name: tooLongOr(name, 'required' as const) }),
      ...(password && {
        password: tooLongOr(password, values.password === '' ? 'required' : 'tooShort'),
      }),
    },
  }
}
