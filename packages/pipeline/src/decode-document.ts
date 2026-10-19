const utf8 = new TextDecoder('utf-8', { fatal: true })

// EDIFACT in UNOA to UNOC is ISO 8859-1, which is rarely valid UTF-8 once it holds an umlaut.
export const decodeDocument = (content: Buffer) => {
  try {
    return utf8.decode(content)
  } catch {
    return content.toString('latin1')
  }
}
