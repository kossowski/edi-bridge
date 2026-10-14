export interface Delimiters {
  component: string
  element: string
  decimal: string
  release: string
  repetition: string
  segment: string
}

export type Element = string[]

export interface Segment {
  tag: string
  elements: Element[]
}

export interface Message {
  header: Segment
  segments: Segment[]
  trailer: Segment
}

export type LineBreak = '' | '\n' | '\r' | '\r\n'

// lineBreaks holds the break before each segment from UNB to UNZ, so the first one follows the UNA.
export interface Whitespace {
  lineBreaks: LineBreak[]
  trailingText: string
}

export interface Interchange {
  hasServiceStringAdvice: boolean
  delimiters: Delimiters
  header: Segment
  messages: Message[]
  trailer: Segment
  whitespace: Whitespace
}
