import type { Message } from '@edi-bridge/edifact'

const orderNumberOf = ({ segments }: Message) =>
  segments.find(({ tag, elements }) => tag === 'RFF' && elements[0]?.[0] === 'ON')?.elements[0]?.[1]

export const documentNumberOf = ({ segments }: Message) =>
  segments.find(({ tag }) => tag === 'BGM')?.elements[1]?.[0] || null

// A DESADV or INVOIC names its order in RFF+ON; an ORDERS is the order, so its BGM number is.
export const businessReferenceOf = (message: Message) =>
  orderNumberOf(message) || documentNumberOf(message)
