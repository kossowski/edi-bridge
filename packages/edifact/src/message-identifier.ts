import type { MessageIdentifier } from './definitions/definition'
import type { Segment } from './model'

export const messageIdentifierElement = 2

export const hasMessageIdentifier = (header: Segment, identifier: MessageIdentifier) => {
  const [type, version, release, controllingAgency] =
    header.elements[messageIdentifierElement - 1] ?? []

  return (
    identifier.type === type &&
    identifier.version === version &&
    identifier.release === release &&
    identifier.controllingAgency === controllingAgency
  )
}
