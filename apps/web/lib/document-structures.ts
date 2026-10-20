import { ApiError } from '@/lib/api/client'

export function onlyDocumentStructureId(
  documentStructures: ReadonlyArray<{ id: string }> | undefined,
): string | null {
  const [only, ...others] = documentStructures ?? []

  return only !== undefined && others.length === 0 ? only.id : null
}

/** The api answers a create with 422 when its Document Structure no longer exists. */
export function isMissingDocumentStructure(error: Error | null): boolean {
  return error instanceof ApiError && error.status === 422
}
