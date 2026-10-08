export function seedId(prefix: number, index: number) {
  return `${String(prefix).padStart(8, '0')}-0000-4000-8000-${String(index).padStart(12, '0')}`
}
