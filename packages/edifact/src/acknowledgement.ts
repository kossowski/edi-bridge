import { hasMessageIdentifier } from './message-identifier'

import type { Element, Message } from './model'

export type ReadAcknowledgementErrorCode =
  'missing-element' | 'missing-interchange-response' | 'unknown-code' | 'unsupported-message-type'

export class ReadAcknowledgementError extends Error {
  override readonly name = 'ReadAcknowledgementError'

  constructor(readonly code: ReadAcknowledgementErrorCode) {
    super(code)
  }
}

export interface InterchangeParty {
  identification: string
  qualifier?: string
}

export type InterchangeAction = 'accepted' | 'rejected' | 'received'

export interface AcknowledgedInterchange {
  controlReference: string
  sender: InterchangeParty
  recipient: InterchangeParty
  action: InterchangeAction
}

const contrlIdentifier = { type: 'CONTRL', version: 'D', release: '3', controllingAgency: 'UN' }

const interchangeActions = new Map<string, InterchangeAction>([
  ['4', 'rejected'],
  ['7', 'accepted'],
  ['8', 'received'],
])

const requiredValue = (element: Element | undefined) => {
  const value = element?.[0]

  if (!value) {
    throw new ReadAcknowledgementError('missing-element')
  }

  return value
}

const partyOf = (element: Element | undefined): InterchangeParty => {
  const identification = requiredValue(element)
  const qualifier = element?.[1]

  return qualifier ? { identification, qualifier } : { identification }
}

export const readAcknowledgedInterchange = (message: Message): AcknowledgedInterchange => {
  if (!hasMessageIdentifier(message.header, contrlIdentifier)) {
    throw new ReadAcknowledgementError('unsupported-message-type')
  }

  const [interchangeResponse] = message.segments

  if (interchangeResponse?.tag !== 'UCI') {
    throw new ReadAcknowledgementError('missing-interchange-response')
  }

  const [controlReference, sender, recipient, actionCode] = interchangeResponse.elements
  const action = interchangeActions.get(requiredValue(actionCode))

  if (action === undefined) {
    throw new ReadAcknowledgementError('unknown-code')
  }

  return {
    controlReference: requiredValue(controlReference),
    sender: partyOf(sender),
    recipient: partyOf(recipient),
    action,
  }
}
