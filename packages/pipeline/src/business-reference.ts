import type { Message } from '@edi-bridge/edifact'

const orderNumberOf = ({ segments }: Message) =>
  segments.find(({ tag, elements }) => tag === 'RFF' && elements[0]?.[0] === 'ON')
    ?.elements[0]?.[1] || null

export const documentNumberOf = ({ segments }: Message) =>
  segments.find(({ tag }) => tag === 'BGM')?.elements[1]?.[0] || null

// The order number in RFF+ON when the Message names its order, else its BGM number.
export const businessReferenceOf = (message: Message) =>
  orderNumberOf(message) ?? documentNumberOf(message)

// Both references of a Message, so each Run stores them together.
export const referencesOf = (message: Message) => ({
  businessReference: businessReferenceOf(message),
  documentNumber: documentNumberOf(message),
})
