import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { messageDefinitions } from './definitions/message-definitions'
import {
  buildContrl,
  BuildContrlError,
  type Delimiters,
  type Interchange,
  type Message,
  parse,
  ParseError,
  isBrokenMessage,
  parseMessages,
  readAcknowledgedInterchange,
  ReadAcknowledgementError,
  serialize,
  SerializeError,
  serializeMessage,
  validate,
  ValidationError,
} from './index'

const goldenDirectory = (kind: string) => new URL(`../golden/${kind}/`, import.meta.url)

const goldenNames = (kind: string) =>
  readdirSync(goldenDirectory(kind))
    .filter((file) => file.endsWith('.edi'))
    .map((file) => file.slice(0, -'.edi'.length))

const readGolden = (kind: string, name: string, extension: string) =>
  readFileSync(new URL(`${name}.${extension}`, goldenDirectory(kind)), 'latin1')

const thrownBy = (action: () => void) => {
  try {
    action()
  } catch (error) {
    return error
  }

  throw new Error('The action finished without an error')
}

describe('parse', () => {
  it.each(goldenNames('valid'))('parses the valid Interchange %s', (name) => {
    expect(parse(readGolden('valid', name, 'edi'))).toEqual(
      JSON.parse(readGolden('valid', name, 'json')),
    )
  })

  it.each(goldenNames('broken'))('reports the error in the broken Interchange %s', (name) => {
    const error = thrownBy(() => parse(readGolden('broken', name, 'edi')))

    expect(error).toBeInstanceOf(ParseError)
    expect(error).toMatchObject(JSON.parse(readGolden('broken', name, 'json')))
  })

  it.each([
    [
      'default delimiters',
      "UNB+UNOC:3+A+B+261014:0930+1'UNH+1+INVOIC:D:96A:UN:EAN008'FTX+AAI+++O?'NEIL ?+ SON??:NOTE?: 30 DAYS'UNT+3+1'UNZ+1+1'",
      ["O'NEIL + SON?", 'NOTE: 30 DAYS'],
    ],
    [
      'custom delimiters',
      'UNA|^,! ~UNB^UNOC|3^A^B^261014|0930^1~UNH^1^INVOIC|D|96A|UN|EAN008~FTX^AAI^^^O!~NEIL !^ SON!!|NOTE!| 30 DAYS~UNT^3^1~UNZ^1^1~',
      ['O~NEIL ^ SON!', 'NOTE| 30 DAYS'],
    ],
  ])('reads every released delimiter as text with %s', (_case, text, freeText) => {
    const interchange = parse(text)

    expect(interchange.messages[0]?.segments[0]?.elements[3]).toEqual(freeText)
  })

  it('reports a segment error in a later Message before a trailer error in an earlier one', () => {
    const error = thrownBy(() =>
      parse(
        "UNB+UNOC:3+A+B+261014:0930+CTL1'UNH+M1+ORDERS:D:96A:UN:EAN008'UNT+3+M1'UNH+M2+ORDERS:D:96A:UN:EAN008'bgm+220+PO2+9'UNT+3+M2'UNZ+2+CTL1'",
      ),
    )

    expect(error).toMatchObject({ code: 'invalid-segment-tag', position: { segment: 5 } })
  })

  it('treats a space in the UNA release position as no release character', () => {
    const interchange = parse(
      "UNA:+.  'UNB+UNOC:3+A B+C+261014:0930+1'UNH+1+ORDERS:D:96A:UN:EAN008'FTX+AAI+++O K'UNT+3+1'UNZ+1+1'",
    )

    expect(interchange.header.elements[1]).toEqual(['A B'])
    expect(interchange.messages[0]?.segments[0]?.elements[3]).toEqual(['O K'])
  })
})

describe('parseMessages', () => {
  const interchangeOf = (...messages: string[]) =>
    `UNB+UNOC:3+A+B+261014:0930+CTL1'${messages.join('')}UNZ+${String(messages.length)}+CTL1'`

  const firstMessage = "UNH+M1+ORDERS:D:96A:UN:EAN008'BGM+220+PO1+9'UNT+3+M1'"

  it('returns a valid Message next to a Message with a wrong segment count', () => {
    const interchange = parseMessages(
      interchangeOf(firstMessage, "UNH+M2+ORDERS:D:96A:UN:EAN008'BGM+220+PO2+9'UNT+4+M2'"),
    )

    const [validMessage, brokenMessage] = interchange.messages

    expect(interchange.messages).toHaveLength(2)
    expect(validMessage).toEqual({
      header: { tag: 'UNH', elements: [['M1'], ['ORDERS', 'D', '96A', 'UN', 'EAN008']] },
      segments: [{ tag: 'BGM', elements: [['220'], ['PO1'], ['9']] }],
      trailer: { tag: 'UNT', elements: [['3'], ['M1']] },
    })
    expect(brokenMessage).toMatchObject({
      header: { tag: 'UNH', elements: [['M2'], ['ORDERS', 'D', '96A', 'UN', 'EAN008']] },
      error: { code: 'segment-count-mismatch', position: { segment: 7, element: 1, component: 1 } },
    })
    expect(brokenMessage).toHaveProperty('error', expect.any(ParseError))
  })

  const secondMessage = "UNH+M2+ORDERS:D:96A:UN:EAN008'BGM+220+PO2+9'UNT+3+M2'"

  const outcomes = (text: string) =>
    parseMessages(text).messages.map((message) =>
      isBrokenMessage(message)
        ? { reference: message.header.elements[0]?.[0], error: message.error.message }
        : { reference: message.header.elements[0]?.[0] },
    )

  it.each([
    ['an invalid segment tag', "bgm+220+PO1+9'", 'invalid-segment-tag at segment 3'],
    [
      'an unneeded release character',
      "BGM+220+PO?1+9'",
      'unneeded-release-character at segment 3, element 2, component 1',
    ],
  ])('keeps the other Messages when one has %s', (_case, brokenSegment, error) => {
    expect(
      outcomes(
        interchangeOf(`UNH+M1+ORDERS:D:96A:UN:EAN008'${brokenSegment}UNT+3+M1'`, secondMessage),
      ),
    ).toEqual([{ reference: 'M1', error }, { reference: 'M2' }])
  })

  it.each([
    [
      'an invalid segment tag',
      "bgm+220+PO1+9'",
      { code: 'invalid-segment-tag', position: { segment: 5 } },
    ],
    [
      'an unneeded release character',
      "BGM+220+PO?1+9'",
      {
        code: 'unneeded-release-character',
        position: { segment: 5, element: 2, component: 1 },
      },
    ],
  ])('fails the whole parse for %s between Messages', (_case, brokenSegment, error) => {
    const thrown = thrownBy(() =>
      parseMessages(interchangeOf(firstMessage, brokenSegment, secondMessage)),
    )

    expect(thrown).toBeInstanceOf(ParseError)
    expect(thrown).toMatchObject(error)
  })

  it('keeps the next Message after a Message without a trailer', () => {
    expect(outcomes(readGolden('broken', 'message-without-trailer', 'edi'))).toEqual([
      { reference: 'ME000001', error: 'missing-message-trailer at segment 2' },
      { reference: 'ME000002' },
    ])
  })

  const messageErrorGoldenNames = [
    'doubled-segment-terminator',
    'last-message-without-trailer',
    'lowercase-segment-tag',
    'message-reference-mismatch',
    'message-segment-count-mismatch',
    'message-without-trailer',
    'unneeded-release-character',
  ]

  it.each(messageErrorGoldenNames)('reports the error in %s on its Message', (name) => {
    const errors = parseMessages(readGolden('broken', name, 'edi')).messages.flatMap((message) =>
      isBrokenMessage(message) ? [message.error] : [],
    )

    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatchObject(JSON.parse(readGolden('broken', name, 'json')))
  })

  it.each(
    goldenNames('broken').filter(
      (name) =>
        !messageErrorGoldenNames.includes(name) &&
        name !== 'message-without-trailer-at-end-of-text',
    ),
  )('fails the whole parse for the envelope error in %s', (name) => {
    const error = thrownBy(() => parseMessages(readGolden('broken', name, 'edi')))

    expect(error).toBeInstanceOf(ParseError)
    expect(error).toMatchObject(JSON.parse(readGolden('broken', name, 'json')))
  })

  it('fails the whole parse when the text ends inside a Message', () => {
    const error = thrownBy(() =>
      parseMessages(readGolden('broken', 'message-without-trailer-at-end-of-text', 'edi')),
    )

    expect(error).toBeInstanceOf(ParseError)
    expect(error).toMatchObject({
      code: 'missing-interchange-trailer',
      position: { segment: 2 },
    })
  })

  it('returns the envelope of an Interchange as parse does', () => {
    const text = readGolden('valid', 'orders-with-multiple-messages', 'edi')

    expect(parseMessages(text)).toEqual(
      JSON.parse(readGolden('valid', 'orders-with-multiple-messages', 'json')),
    )
  })
})

describe('validate', () => {
  const definedMessageTypePrefixes = messageDefinitions.map(
    ({ identifier }) => `${identifier.type.toLowerCase()}-`,
  )

  const validGoldenNamesWithDefinition = goldenNames('valid').filter((name) =>
    definedMessageTypePrefixes.some((prefix) => name.startsWith(prefix)),
  )

  it.each(validGoldenNamesWithDefinition)('accepts the valid Interchange %s', (name) => {
    expect(() => validate(parse(readGolden('valid', name, 'edi')))).not.toThrow()
  })

  it.each(goldenNames('invalid'))('reports the error in the invalid Interchange %s', (name) => {
    const interchange = parse(readGolden('invalid', name, 'edi'))
    const error = thrownBy(() => validate(interchange))

    expect(error).toBeInstanceOf(ValidationError)
    expect(error).toMatchObject(JSON.parse(readGolden('invalid', name, 'json')))
  })

  const withFreeText = (characterSet: string, text: string) =>
    parse(
      readGolden('valid', 'orders-without-una', 'edi')
        .replace('UNOC', characterSet)
        .replace("DTM+2:20221201:102'", `DTM+2:20221201:102'FTX+AAI+++${text}'`)
        .replace('UNT+14+', 'UNT+15+'),
    )

  it.each([
    ['UNOA', 'a lower-case letter', 'NO SALe', 7],
    ['UNOB', 'a letter with a diacritic', 'Grüße', 3],
    ['UNOC', 'a code point above U+00FF', 'Price in €', 10],
  ])('reports the first character outside %s, %s', (characterSet, _character, text, character) => {
    const error = thrownBy(() => validate(withFreeText(characterSet, text)))

    expect(error).toBeInstanceOf(ValidationError)
    expect(error).toMatchObject({
      code: 'invalid-character',
      position: { segment: 6, element: 4, component: 1, character },
      message: `invalid-character at segment 6, element 4, component 1, character ${String(character)}`,
    })
  })

  it.each([
    ['UNOA', 'NO SALE: 50% (1/2) "NOW"!'],
    ['UNOB', 'No sale today'],
    ['UNOC', 'Grüße'],
    ['UNOD', 'Price in €'],
  ])('accepts a Message within the repertoire of %s', (characterSet, text) => {
    expect(() => validate(withFreeText(characterSet, text))).not.toThrow()
  })
})

describe('serialize', () => {
  it.each(goldenNames('valid'))('reproduces the valid Interchange %s byte for byte', (name) => {
    const text = readGolden('valid', name, 'edi')

    expect(serialize(parse(text))).toBe(text)
  })
})

describe('serialize an Interchange built by hand', () => {
  const builtInterchange = (delimiters: Delimiters): Interchange => ({
    hasServiceStringAdvice: false,
    delimiters,
    header: {
      tag: 'UNB',
      elements: [
        ['UNOC', '3'],
        ['4012345000016', '14'],
        ['5412345000013', '14'],
        ['261014', '0930'],
        ['CTL1'],
      ],
    },
    messages: [
      {
        header: { tag: 'UNH', elements: [['ME1'], ['ORDERS', 'D', '96A', 'UN', 'EAN008']] },
        segments: [{ tag: 'FTX', elements: [['AAI'], [], [], ["O'NEIL + SON: 50% OFF"]] }],
        trailer: { tag: 'UNT', elements: [['3'], ['ME1']] },
      },
    ],
    trailer: { tag: 'UNZ', elements: [['1'], ['CTL1']] },
  })

  it('writes no line breaks and no UNA for default delimiters', () => {
    expect(
      serialize(
        builtInterchange({
          component: ':',
          element: '+',
          decimal: '.',
          release: '?',
          repetition: ' ',
          segment: "'",
        }),
      ),
    ).toBe(
      "UNB+UNOC:3+4012345000016:14+5412345000013:14+261014:0930+CTL1'UNH+ME1+ORDERS:D:96A:UN:EAN008'FTX+AAI+++O?'NEIL ?+ SON?: 50% OFF'UNT+3+ME1'UNZ+1+CTL1'",
    )
  })

  it('writes a UNA for delimiters that differ from the defaults', () => {
    expect(
      serialize(
        builtInterchange({
          component: '|',
          element: '^',
          decimal: ',',
          release: '!',
          repetition: ' ',
          segment: '~',
        }),
      ),
    ).toBe(
      "UNA|^,! ~UNB^UNOC|3^4012345000016|14^5412345000013|14^261014|0930^CTL1~UNH^ME1^ORDERS|D|96A|UN|EAN008~FTX^AAI^^^O'NEIL + SON: 50% OFF~UNT^3^ME1~UNZ^1^CTL1~",
    )
  })
})

describe('serialize without a release character', () => {
  it('rejects a value that contains a service character', () => {
    const interchange: Interchange = {
      hasServiceStringAdvice: true,
      delimiters: {
        component: ':',
        element: '+',
        decimal: '.',
        release: ' ',
        repetition: ' ',
        segment: "'",
      },
      header: { tag: 'UNB', elements: [['UNOC', '3'], ['A'], ['B'], ['261014', '0930'], ['1']] },
      messages: [
        {
          header: { tag: 'UNH', elements: [['1'], ['ORDERS', 'D', '96A', 'UN', 'EAN008']] },
          segments: [{ tag: 'FTX', elements: [['AAI'], [''], [''], ['OK', "O'NEIL"]] }],
          trailer: { tag: 'UNT', elements: [['3'], ['1']] },
        },
      ],
      trailer: { tag: 'UNZ', elements: [['1'], ['1']] },
    }

    expect(() => serialize(interchange)).toThrow(SerializeError)
    expect(() => serialize(interchange)).toThrow(
      expect.objectContaining({
        code: 'unreleasable-service-character',
        position: { segment: 4, element: 4, component: 2 },
      }),
    )
  })
})

describe('readAcknowledgedInterchange', () => {
  const messageOf = (
    segmentCount: number,
    segments: string,
    identifier = 'CONTRL:D:3:UN:EAN002',
  ) => {
    const [message] = parse(
      `UNB+UNOC:3+5412345000013:14+4012345000016:14+261015:0800+ACK1'UNH+1+${identifier}'${segments}UNT+${segmentCount}+1'UNZ+1+ACK1'`,
    ).messages

    if (message === undefined) {
      throw new Error('The Interchange has no Message')
    }

    return message
  }

  it.each([
    ['contrl-accepting-interchange', '88776655', '7350000001266', '7300015200048', 'accepted'],
    ['contrl-rejecting-message', '654321', '7300015200048', '7350000001266', 'rejected'],
    ['contrl-rejecting-interchange', 'CTL00021', '4012345000016', '5412345000013', 'rejected'],
  ])(
    'reads the acknowledged Interchange of the valid Interchange %s',
    (name, controlReference, sender, receiver, action) => {
      const [message] = parse(readGolden('valid', name, 'edi')).messages

      expect(message && readAcknowledgedInterchange(message)).toEqual({
        controlReference,
        sender: { identification: sender, qualifier: '14' },
        receiver: { identification: receiver, qualifier: '14' },
        action,
      })
    },
  )

  it.each([
    ['7', '4', 'rejected'],
    ['7', '7', 'accepted'],
    ['4', '7', 'rejected'],
  ])(
    'reads the action code %s with a Message action code %s as %s',
    (interchangeCode, messageCode, action) => {
      expect(
        readAcknowledgedInterchange(
          messageOf(
            5,
            `UCI+CTL1+4012345000016:14+5412345000013:14+${interchangeCode}'UCM+1+ORDERS:D:96A:UN:EAN008+7'UCM+2+ORDERS:D:96A:UN:EAN008+${messageCode}'`,
          ),
        ),
      ).toMatchObject({ action })
    },
  )

  it.each([
    ['4', 'rejected'],
    ['8', 'received'],
  ])('reads the action code %s as %s', (code, action) => {
    expect(
      readAcknowledgedInterchange(
        messageOf(3, `UCI+CTL1+4012345000016:14+5412345000013:14+${code}'`),
      ),
    ).toMatchObject({ action })
  })

  it.each([
    [
      'unsupported-message-type',
      'an ORDERS Message',
      messageOf(3, "BGM+220+PO1+9'", 'ORDERS:D:96A:UN:EAN008'),
    ],
    [
      'unsupported-message-type',
      'a CONTRL of syntax version 4',
      messageOf(3, "UCI+CTL1+4012345000016:14+5412345000013:14+7'", 'CONTRL:4:1:UN'),
    ],
    ['missing-interchange-response', 'a CONTRL without UCI', messageOf(2, '')],
    [
      'missing-element',
      'a UCI without control reference',
      messageOf(3, "UCI++4012345000016:14+5412345000013:14+7'"),
    ],
    ['missing-element', 'a UCI without sender', messageOf(3, "UCI+CTL1++5412345000013:14+7'")],
    ['missing-element', 'a UCI without receiver', messageOf(3, "UCI+CTL1+4012345000016:14++7'")],
    [
      'missing-element',
      'a UCI without action',
      messageOf(3, "UCI+CTL1+4012345000016:14+5412345000013:14'"),
    ],
    [
      'missing-element',
      'a UCM without action',
      messageOf(4, "UCI+CTL1+4012345000016:14+5412345000013:14+7'UCM+1+ORDERS:D:96A:UN:EAN008'"),
    ],
    [
      'unknown-code',
      'a UCI with an action outside syntax version 3 and EANCOM',
      messageOf(3, "UCI+CTL1+4012345000016:14+5412345000013:14+5'"),
    ],
  ])('reports %s for %s', (code, _case, message) => {
    const error = thrownBy(() => readAcknowledgedInterchange(message))

    expect(error).toBeInstanceOf(ReadAcknowledgementError)
    expect(error).toMatchObject({ code })
  })
})

describe('buildContrl', () => {
  // Every CONTRL must pass validation and read back as the Acknowledgement it states.
  const readBack = (contrl: Message) => {
    const interchange = parse(
      `UNB+UNOC:3+7350000001266:14+7300015200048:14+261020:0100+R1'${serializeMessage(contrl).replaceAll('\n', '')}UNZ+1+R1'`,
    )

    validate(interchange)

    const [message] = interchange.messages

    return message && readAcknowledgedInterchange(message)
  }

  const segmentsOf = (text: string) => {
    const contrl = buildContrl(text, 'C1')

    readBack(contrl)

    return serializeMessage(contrl).split('\n')
  }

  const orders = (reference: string, ...segments: string[]) =>
    `UNH+${reference}+ORDERS:D:96A:UN:EAN008'${segments.join('')}UNT+${String(segments.length + 2)}+${reference}'`

  const interchangeOf = (...messages: string[]) =>
    `UNB+UNOC:3+7300015200048:14+7350000001266:14+221125:1605+88776655'${messages.join('')}UNZ+${String(messages.length)}+88776655'`

  const validOrder = ["BGM+220+PO1+9'", "DTM+137:20261020:102'", "UNS+S'"]

  const uci = "UCI+88776655+7300015200048:14+7350000001266:14+7'"

  it('accepts an Interchange without errors and each of its Messages', () => {
    expect(
      segmentsOf(interchangeOf(orders('M1', ...validOrder), orders('M2', ...validOrder))),
    ).toEqual([
      "UNH+C1+CONTRL:D:3:UN:EAN002'",
      uci,
      "UCM+M1+ORDERS:D:96A:UN:EAN008+7'",
      "UCM+M2+ORDERS:D:96A:UN:EAN008+7'",
      "UNT+5+C1'",
    ])
  })

  it('rejects a Message with an invalid data element at its position', () => {
    const text = interchangeOf(
      orders('M1', ...validOrder),
      orders('M2', "BGM+220+PO2+9'", `DTM+137:${'2'.repeat(40)}:102'`, "UNS+S'"),
    )

    expect(segmentsOf(text)).toEqual([
      "UNH+C1+CONTRL:D:3:UN:EAN002'",
      uci,
      "UCM+M1+ORDERS:D:96A:UN:EAN008+7'",
      "UCM+M2+ORDERS:D:96A:UN:EAN008+4'",
      "UCS+3'",
      "UCD+39+1:2'",
      "UNT+7+C1'",
    ])
    expect(readBack(buildContrl(text, 'C1'))).toMatchObject({ action: 'rejected' })
  })

  it.each([
    [
      'a wrong segment count',
      "UNH+M2+ORDERS:D:96A:UN:EAN008'BGM+220+PO2+9'UNT+5+M2'",
      ["UCM+M2+ORDERS:D:96A:UN:EAN008+4+29+UNT+1'"],
    ],
    [
      'a wrong message reference in its trailer',
      "UNH+M2+ORDERS:D:96A:UN:EAN008'BGM+220+PO2+9'UNT+3+M3'",
      ["UCM+M2+ORDERS:D:96A:UN:EAN008+4+28+UNT+2'"],
    ],
    [
      'an unneeded release character',
      "UNH+M2+ORDERS:D:96A:UN:EAN008'BGM+220+P?O2+9'UNT+3+M2'",
      ["UCM+M2+ORDERS:D:96A:UN:EAN008+4'", "UCS+2'", "UCD+22+2'"],
    ],
    [
      'an invalid segment tag',
      "UNH+M2+ORDERS:D:96A:UN:EAN008'bgm+220+PO2+9'UNT+3+M2'",
      ["UCM+M2+ORDERS:D:96A:UN:EAN008+4'", "UCS+2+12'"],
    ],
    [
      'no trailer',
      "UNH+M2+ORDERS:D:96A:UN:EAN008'BGM+220+PO2+9'",
      ["UCM+M2+ORDERS:D:96A:UN:EAN008+4+13+UNT'"],
    ],
    [
      'an unsupported Message Type',
      "UNH+M2+APERAK:D:96A:UN:EAN003'BGM+305+AP2+9'UNT+3+M2'",
      ["UCM+M2+APERAK:D:96A:UN:EAN003+4+14+UNH+2'"],
    ],
    [
      'a missing segment',
      "UNH+M2+ORDERS:D:96A:UN:EAN008'BGM+220+PO2+9'UNS+S'UNT+4+M2'",
      ["UCM+M2+ORDERS:D:96A:UN:EAN008+4'", "UCS+3+13'"],
    ],
  ])('rejects a Message with %s', (_case, brokenMessage, responses) => {
    expect(segmentsOf(interchangeOf(orders('M1', ...validOrder), brokenMessage))).toEqual([
      "UNH+C1+CONTRL:D:3:UN:EAN002'",
      uci,
      "UCM+M1+ORDERS:D:96A:UN:EAN008+7'",
      ...responses,
      `UNT+${String(responses.length + 4)}+C1'`,
    ])
  })

  it('counts the error positions from each UNH after a service string advice', () => {
    const text = `UNA:+.? '${interchangeOf(
      orders('M1', "BGM+220+P?O1+9'", "DTM+137:20261020:102'", "UNS+S'"),
      orders('M2', ...validOrder),
      orders('M3', "BGM+220+PO3+9'", `DTM+137:${'2'.repeat(40)}:102'`, "UNS+S'"),
    )}`

    expect(segmentsOf(text)).toEqual([
      "UNH+C1+CONTRL:D:3:UN:EAN002'",
      uci,
      "UCM+M1+ORDERS:D:96A:UN:EAN008+4'",
      "UCS+2'",
      "UCD+22+2'",
      "UCM+M2+ORDERS:D:96A:UN:EAN008+7'",
      "UCM+M3+ORDERS:D:96A:UN:EAN008+4'",
      "UCS+3'",
      "UCD+39+1:2'",
      "UNT+10+C1'",
    ])
  })

  const unb = "UNB+UNOC:3+7300015200048:14+7350000001266:14+221125:1605+88776655'"

  it.each([
    [
      'a wrong Message count',
      `${unb}${orders('M1', ...validOrder)}UNZ+2+88776655'`,
      "UCI+88776655+7300015200048:14+7350000001266:14+4+29+UNZ+1'",
    ],
    [
      'a wrong control reference in its trailer',
      `${unb}${orders('M1', ...validOrder)}UNZ+1+88776656'`,
      "UCI+88776655+7300015200048:14+7350000001266:14+4+28+UNZ+2'",
    ],
    [
      'no trailer',
      `${unb}${orders('M1', ...validOrder)}`,
      "UCI+88776655+7300015200048:14+7350000001266:14+4+13+UNZ'",
    ],
    [
      'a segment outside a Message',
      `${unb}BGM+220+PO1+9'UNZ+0+88776655'`,
      "UCI+88776655+7300015200048:14+7350000001266:14+4+33'",
    ],
    [
      'an invalid character in its header',
      `UNB+UNOA:3+7300015200048:14+Recipient:14+221125:1605+88776655'${orders('M1', ...validOrder)}UNZ+1+88776655'`,
      "UCI+88776655+7300015200048:14+Recipient:14+4+21+UNB+3:1'",
    ],
  ])('rejects an Interchange with %s', (_case, text, response) => {
    expect(segmentsOf(text)).toEqual(["UNH+C1+CONTRL:D:3:UN:EAN002'", response, "UNT+3+C1'"])
    expect(readBack(buildContrl(text, 'C1'))).toMatchObject({ action: 'rejected' })
  })

  it.each([
    [
      'a too long reference',
      orders('M2'.padEnd(20, 'X'), ...validOrder),
      "UCI+88776655+7300015200048:14+7350000001266:14+4+39+UNH+1'",
    ],
    [
      'an empty reference',
      orders('', ...validOrder),
      "UCI+88776655+7300015200048:14+7350000001266:14+4+13+UNH+1'",
    ],
    [
      'an unknown Message Type',
      "UNH+M2+ZZZZZZ:D:96A:UN:EAN008'BGM+220'UNT+3+M2'",
      "UCI+88776655+7300015200048:14+7350000001266:14+4+12+UNH+2:1'",
    ],
    [
      'no message identifier',
      "UNH+M2'UNT+2+M2'",
      "UCI+88776655+7300015200048:14+7350000001266:14+4+13+UNH+2'",
    ],
  ])(
    'rejects the Interchange when a UCM cannot echo the header of a Message with %s',
    (_case, brokenMessage, response) => {
      const text = interchangeOf(orders('M1', ...validOrder), brokenMessage)

      expect(segmentsOf(text)).toEqual(["UNH+C1+CONTRL:D:3:UN:EAN002'", response, "UNT+3+C1'"])
      expect(readBack(buildContrl(text, 'C1'))).toMatchObject({ action: 'rejected' })
    },
  )

  it.each([
    [
      'control reference',
      `UNB+UNOC:3+7300015200048:14+7350000001266:14+221125:1605+${'R'.repeat(20)}'UNZ+0+${'R'.repeat(20)}'`,
    ],
    ['sender', `UNB+UNOC:3+${'7'.repeat(40)}:14+7350000001266:14+221125:1605+R1'UNZ+0+R1'`],
  ])('builds no CONTRL when no UCI can echo the %s of the header', (_case, text) => {
    const error = thrownBy(() => buildContrl(text, 'C1'))

    expect(error).toBeInstanceOf(BuildContrlError)
    expect(error).toMatchObject({ code: 'unechoable-interchange-header' })
  })

  it.each([
    ['no header', "UNH+M1+ORDERS:D:96A:UN:EAN008'UNT+2+M1'"],
    [
      'a broken header',
      "UNB+UNOC:3+73000?15200048:14+7350000001266:14+221125:1605+88776655'UNZ+0+88776655'",
    ],
    [
      'a header without control reference',
      "UNB+UNOC:3+7300015200048:14+7350000001266:14+221125:1605'UNZ+0+'",
    ],
    ['a broken service string advice', "UNA:+'"],
  ])('builds no CONTRL for an Interchange with %s', (_case, text) => {
    const error = thrownBy(() => buildContrl(text, 'C1'))

    expect(error).toBeInstanceOf(BuildContrlError)
    expect(error).toMatchObject({ code: 'unreadable-interchange-header' })
  })
})
