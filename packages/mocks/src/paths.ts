export function containerOf(paths: Iterable<string>, path: string) {
  return [...paths].some((inner) => inner.startsWith(`${path}/`) || inner.startsWith(`${path}.`))
}
