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
