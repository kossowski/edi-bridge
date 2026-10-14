export interface Delimiters {
  component: string
  element: string
  decimal: string
  release: string
  repetition: string
  segment: string
}

export interface Segment {
  tag: string
  elements: string[][]
}

export interface Message {
  header: Segment
  segments: Segment[]
  trailer: Segment
}

export interface Interchange {
  serviceStringAdvice: boolean
  delimiters: Delimiters
  header: Segment
  messages: Message[]
  trailer: Segment
}

const defaultDelimiters: Delimiters = {
  component: ':',
  element: '+',
  decimal: '.',
  release: '?',
  repetition: ' ',
  segment: "'",
}

const lineBreak = /[\n\r]/

const tokenize = (text: string, delimiters: Delimiters): Segment[] => {
  const segments: Segment[] = []
  let elements: string[][] = []
  let components: string[] = []
  let value = ''
  let released = false

  for (const character of text) {
    if (released) {
      value += character
      released = false
    } else if (character === delimiters.release) {
      released = true
    } else if (character === delimiters.component) {
      components.push(value)
      value = ''
    } else if (character === delimiters.element) {
      elements.push([...components, value])
      components = []
      value = ''
    } else if (character === delimiters.segment) {
      const [[tag = ''] = [], ...rest] = [...elements, [...components, value]]
      segments.push({ tag, elements: rest })
      elements = []
      components = []
      value = ''
    } else {
      const atSegmentStart = elements.length === 0 && components.length === 0 && value === ''

      if (!(atSegmentStart && lineBreak.test(character))) {
        value += character
      }
    }
  }

  return segments
}

const serviceStringAdviceLength = 9

const readDelimiters = (advice: string): Delimiters => ({
  component: advice.charAt(3),
  element: advice.charAt(4),
  decimal: advice.charAt(5),
  release: advice.charAt(6),
  repetition: advice.charAt(7),
  segment: advice.charAt(8),
})

export const parse = (text: string): Interchange => {
  const serviceStringAdvice = text.startsWith('UNA')

  const delimiters = serviceStringAdvice
    ? readDelimiters(text.slice(0, serviceStringAdviceLength))
    : defaultDelimiters

  const segments = tokenize(
    serviceStringAdvice ? text.slice(serviceStringAdviceLength) : text,
    delimiters,
  )

  const header = segments[0]
  const trailer = segments.at(-1)

  if (header?.tag !== 'UNB' || trailer?.tag !== 'UNZ') {
    throw new Error('An Interchange starts with UNB and ends with UNZ')
  }

  const messages: Message[] = []
  let open: Omit<Message, 'trailer'> | undefined

  for (const [index, segment] of segments.slice(1, -1).entries()) {
    if (segment.tag === 'UNH' && !open) {
      open = { header: segment, segments: [] }
    } else if (segment.tag === 'UNT' && open) {
      messages.push({ ...open, trailer: segment })
      open = undefined
    } else if (open && segment.tag !== 'UNH') {
      open.segments.push(segment)
    } else {
      throw new Error(`Unexpected ${segment.tag} segment at segment ${index + 2}`)
    }
  }

  if (open) {
    throw new Error('A Message ends with UNT')
  }

  return { serviceStringAdvice, delimiters, header, messages, trailer }
}
