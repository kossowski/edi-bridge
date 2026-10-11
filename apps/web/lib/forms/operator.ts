import {
  type Invite,
  inviteInputSchema,
  type InviteInput,
  type WorkspaceInput,
  workspaceInputSchema,
  type WorkspaceRole,
} from '@edi-bridge/contracts'

import { tooLongOr } from './field-errors'

export type WorkspaceNameError = 'required' | 'tooLong'

export function validateWorkspaceForm(values: {
  name: string
  seed: boolean
}): { input: WorkspaceInput } | { error: WorkspaceNameError } {
  const parsed = workspaceInputSchema.safeParse(values)

  if (parsed.success) {
    return { input: parsed.data }
  }

  const issue = parsed.error.issues[0]

  return { error: issue ? tooLongOr(issue, 'required') : 'required' }
}

export type InviteEmailError = 'required' | 'invalid'

export function validateInviteForm(values: {
  email: string
  role: WorkspaceRole
}): { input: InviteInput } | { error: InviteEmailError } {
  const email = values.email.trim()

  if (email === '') {
    return { error: 'required' }
  }

  const parsed = inviteInputSchema.safeParse({ email, role: values.role })

  return parsed.success ? { input: parsed.data } : { error: 'invalid' }
}

export type InviteStatus = 'accepted' | 'pending' | 'expired'

export function inviteStatus(invite: Invite, now: Date): InviteStatus {
  if (invite.acceptedAt !== null) {
    return 'accepted'
  }

  return Date.parse(invite.expiresAt) <= now.getTime() ? 'expired' : 'pending'
}

const workspaceNameCollator = new Intl.Collator('de', { sensitivity: 'accent' })

export function compareWorkspaceNames(a: string, b: string) {
  return workspaceNameCollator.compare(a, b)
}

export function sameWorkspaceName(a: string, b: string) {
  return compareWorkspaceNames(a.trim(), b.trim()) === 0
}
