export function includesText(value: string | null, text: string) {
  return value !== null && value.toLowerCase().includes(text)
}

export function pageOf<Item>(
  items: readonly Item[],
  { page, pageSize }: { page: number; pageSize: number },
) {
  return {
    items: items.slice((page - 1) * pageSize, page * pageSize),
    total: items.length,
    page,
    pageSize,
  }
}
