export function onlyDocumentStructureId(
  documentStructures: ReadonlyArray<{ id: string }> | undefined,
): string | null {
  const [only, ...others] = documentStructures ?? []

  return only !== undefined && others.length === 0 ? only.id : null
}
