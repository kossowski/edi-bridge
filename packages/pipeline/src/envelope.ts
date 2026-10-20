import { DateTime } from 'effect'

import { type Interchange, type Message, type Segment, serialize } from '@edi-bridge/edifact'

import type { CharacterSet } from '@edi-bridge/contracts'

const envelopeTrailer: Segment = { tag: 'UNZ', elements: [] }

export const framed = (
  message: Message,
  header: Segment,
  trailer = envelopeTrailer,
): Interchange => ({
  hasServiceStringAdvice: false,
  delimiters: {
    component: ':',
    element: '+',
    decimal: '.',
    release: '?',
    repetition: ' ',
    segment: "'",
  },
  header,
  messages: [message],
  trailer,
})

const twoDigits = (value: number) => String(value).padStart(2, '0')

type Envelope = {
  characterSet: CharacterSet
  sender: string
  receiver: string
  sentAt: DateTime.Utc
  reference: number
  testMode: boolean
}

// 0035 is element 11 of the UNB, so the optional elements 6 to 10 before it stay empty.
const testIndicator = [[''], [''], [''], [''], [''], ['1']]

export const carriesTestIndicator = (header: Segment | undefined) =>
  header?.elements[10]?.[0] === '1'

export const enveloped = (
  message: Message,
  { characterSet, sender, receiver, sentAt, reference, testMode }: Envelope,
) => {
  const { year, month, day, hour, minute } = DateTime.toPartsUtc(sentAt)

  return serialize({
    ...framed(
      message,
      {
        tag: 'UNB',
        elements: [
          [characterSet, '3'],
          [sender, '14'],
          [receiver, '14'],
          [
            twoDigits(year % 100) + twoDigits(month) + twoDigits(day),
            twoDigits(hour) + twoDigits(minute),
          ],
          [String(reference)],
          ...(testMode ? testIndicator : []),
        ],
      },
      { tag: 'UNZ', elements: [['1'], [String(reference)]] },
    ),
    // The default separators of UNOB are IS1 to IS4, so a UNA declares the printable ones.
    hasServiceStringAdvice: characterSet === 'UNOB',
  })
}
