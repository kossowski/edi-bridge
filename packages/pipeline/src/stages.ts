import { directionOf, type MessageType, type RunStepStage } from '@edi-bridge/contracts'

export function stagesOf(flow: { messageType: MessageType }): RunStepStage[] {
  return directionOf(flow) === 'outbound'
    ? ['receipt', 'mapping', 'validation', 'delivery']
    : ['receipt', 'parse', 'validation', 'mapping', 'delivery']
}
