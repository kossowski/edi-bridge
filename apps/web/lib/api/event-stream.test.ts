import { describe, expect, it } from 'vitest'

import { eventStreamData, splitEventFrames } from './event-stream'

describe('splitEventFrames', () => {
  it('returns the data of each complete frame and keeps the incomplete rest', () => {
    expect(splitEventFrames('data:{"a":1}\n\n: comment\n\ndata: {"b":2}\n\ndata:{"c"')).toEqual({
      data: ['{"a":1}', '{"b":2}'],
      rest: 'data:{"c"',
    })
  })

  it('joins the data lines of one frame and reads CRLF line ends', () => {
    expect(splitEventFrames('data:one\r\ndata:two\r\n\r\n')).toEqual({
      data: ['one\ntwo'],
      rest: '',
    })
  })
})

describe('eventStreamData', () => {
  it('yields the frames of a stream whose chunks split them anywhere', async () => {
    const encoder = new TextEncoder()
    const chunks = ['data:{"a"', ':1}\n', '\ndata:{"b":2}\n\n']

    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk))
        }

        controller.close()
      },
    })

    const data: string[] = []

    for await (const item of eventStreamData(body)) {
      data.push(item)
    }

    expect(data).toEqual(['{"a":1}', '{"b":2}'])
  })
})
