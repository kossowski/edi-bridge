import { group, type MessageDefinition, segment } from './definition'

export const contrl: MessageDefinition = {
  identifier: { type: 'CONTRL', version: 'D', release: '3', controllingAgency: 'UN' },
  segments: [
    segment('UCI', 'M', 1),
    group(1, 'C', 999999, 'UCM', [group(2, 'C', 999, 'UCS', [segment('UCD', 'C', 99)])]),
  ],
}
