export function splitEventFrames(buffer: string) {
  const blocks = buffer.replaceAll('\r\n', '\n').split('\n\n')
  const rest = blocks.pop() ?? ''

  const data = blocks.flatMap((block) => {
    const lines = block
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(line.startsWith('data: ') ? 6 : 5))

    return lines.length > 0 ? [lines.join('\n')] : []
  })

  return { data, rest }
}

export async function* eventStreamData(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    for (;;) {
      const { done, value } = await reader.read()

      if (done) {
        return
      }

      const { data, rest } = splitEventFrames(buffer + decoder.decode(value, { stream: true }))
      buffer = rest

      yield* data
    }
  } finally {
    reader.releaseLock()
  }
}
