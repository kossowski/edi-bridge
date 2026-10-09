export function hash(key: string, basis = 0x811c9dc5) {
  let value = basis

  for (let index = 0; index < key.length; index++) {
    value = Math.imul(value ^ key.charCodeAt(index), 0x01000193)
  }

  return value >>> 0
}
