import type { ParseError } from './parse'

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

export interface BrokenMessage {
  header: Segment
  error: ParseError
}

export type ParsedMessage = Message | BrokenMessage

export const isBrokenMessage = (message: ParsedMessage): message is BrokenMessage =>
  'error' in message

// lineBreaks holds the run of CR and LF characters before each segment from UNB to UNZ.
export interface Whitespace {
  lineBreaks: string[]
  trailingText: string
}

export interface Interchange {
  hasServiceStringAdvice: boolean
  delimiters: Delimiters
  header: Segment
  messages: Message[]
  trailer: Segment
  whitespace?: Whitespace
}

export type Envelope = Omit<Interchange, 'messages'>

export interface ParsedInterchange extends Envelope {
  messages: ParsedMessage[]
}
