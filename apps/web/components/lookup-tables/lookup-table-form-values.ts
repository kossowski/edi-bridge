import {
  lookupTableInputSchema,
  type LookupTableScopeInput,
  type LookupTableSummary,
} from '@edi-bridge/contracts'

import { fieldErrors, type FormIssue, tooLongOr } from '../../lib/forms/field-errors'

export type ScopeKind = LookupTableScopeInput['kind']

export type LookupTableFormValues = {
  name: string
  scopeKind: ScopeKind
  tradingPartnerId: string | null
}

export type LookupTableField = 'name' | 'tradingPartnerId'

export type LookupTableFieldError = 'required' | 'tooLong'

export type LookupTableSettings = { name: string; scope: LookupTableScopeInput }

export type LookupTableFormResult =
  | { input: LookupTableSettings }
  | { errors: Partial<Record<LookupTableField, LookupTableFieldError>> }

const settingsSchema = lookupTableInputSchema.pick({ name: true, scope: true })

const fields = ['name', 'tradingPartnerId'] as const satisfies ReadonlyArray<LookupTableField>

function toField(issue: FormIssue): FormIssue {
  return issue.path[0] === 'scope' ? { ...issue, path: ['tradingPartnerId'] } : issue
}

export function validateLookupTableForm(values: LookupTableFormValues): LookupTableFormResult {
  const parsed = settingsSchema.safeParse({
    name: values.name,
    scope:
      values.scopeKind === 'workspace'
        ? { kind: 'workspace' }
        : { kind: 'tradingPartner', tradingPartnerId: values.tradingPartnerId ?? undefined },
  })

  if (parsed.success) {
    return { input: parsed.data }
  }

  return {
    errors: fieldErrors(
      parsed.error.issues.map(toField),
      fields,
      (field, issue): LookupTableFieldError =>
        field === 'name' ? tooLongOr(issue, 'required') : 'required',
    ),
  }
}

export function toFormValues(table?: LookupTableSummary): LookupTableFormValues {
  return {
    name: table?.name ?? '',
    scopeKind: table?.scope.kind ?? 'workspace',
    tradingPartnerId: table?.scope.kind === 'tradingPartner' ? table.scope.tradingPartner.id : null,
  }
}
