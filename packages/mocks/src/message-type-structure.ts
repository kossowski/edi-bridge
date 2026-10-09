import { http, HttpResponse } from 'msw'

import {
  type EdifactComposite,
  type EdifactElement,
  type EdifactStructureNode,
  messageTypeSchema,
  type MessageTypeStructure,
  messageTypeStructureEndpoint,
} from '@edi-bridge/contracts'

import { messageTypeStructures } from './eancom/structures'
import { notFound } from './responses'

export { messageTypeStructures } from './eancom/structures'

export function messageTypeStructureHandler(apiUrl: string) {
  return http.get<{ messageType: string }>(
    `${apiUrl}${messageTypeStructureEndpoint.path}`,
    ({ params }) => {
      const messageType = messageTypeSchema.safeParse(params.messageType)

      return messageType.success
        ? HttpResponse.json(messageTypeStructures[messageType.data])
        : notFound()
    },
  )
}

export function edifactLeaves(structure: Pick<MessageTypeStructure, 'children'>): EdifactElement[] {
  const visit = (
    node: EdifactStructureNode | EdifactComposite | EdifactElement,
  ): EdifactElement[] => (node.kind === 'element' ? [node] : node.children.flatMap(visit))

  return structure.children.flatMap(visit)
}
