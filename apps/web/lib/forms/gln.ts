import { glnIssue, type GlnIssue } from '@edi-bridge/contracts'

export type GlnError = 'required' | GlnIssue

export function normalizeGln(value: string) {
  return value.replaceAll(/\s/g, '')
}

export function glnError(value: string): GlnError | null {
  const gln = normalizeGln(value)

  return gln === '' ? 'required' : glnIssue(gln)
}
