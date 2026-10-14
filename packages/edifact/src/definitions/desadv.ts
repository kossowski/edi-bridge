import { group, type MessageDefinition, segment } from './definition'

export const desadv: MessageDefinition = {
  identifier: { type: 'DESADV', version: 'D', release: '96A', controllingAgency: 'UN' },
  segments: [
    segment('BGM', 'M', 1),
    segment('DTM', 'C', 10),
    segment('ALI', 'C', 5),
    segment('MEA', 'C', 5),
    segment('MOA', 'C', 5),
    group(1, 'C', 10, 'RFF', [segment('DTM', 'C', 1)]),
    group(2, 'C', 10, 'NAD', [
      segment('LOC', 'C', 10),
      group(3, 'C', 10, 'RFF', [segment('DTM', 'C', 1)]),
      group(4, 'C', 10, 'CTA', [segment('COM', 'C', 5)]),
    ]),
    group(5, 'C', 10, 'TOD', [segment('LOC', 'C', 5), segment('FTX', 'C', 5)]),
    group(6, 'C', 10, 'TDT', [
      segment('PCD', 'C', 6),
      group(7, 'C', 10, 'LOC', [segment('DTM', 'C', 10)]),
    ]),
    group(8, 'C', 10, 'EQD', [
      segment('MEA', 'C', 5),
      segment('SEL', 'C', 25),
      segment('EQA', 'C', 5),
      group(9, 'C', 10, 'HAN', [segment('FTX', 'C', 10)]),
    ]),
    group(10, 'C', 9999, 'CPS', [
      segment('FTX', 'C', 5),
      group(11, 'C', 9999, 'PAC', [
        segment('MEA', 'C', 10),
        segment('QTY', 'C', 10),
        group(12, 'C', 10, 'HAN', [segment('FTX', 'C', 10)]),
        group(13, 'C', 1000, 'PCI', [
          segment('RFF', 'C', 1),
          segment('DTM', 'C', 5),
          segment('GIR', 'C', 99),
          group(14, 'C', 99, 'GIN', [segment('DLM', 'C', 10)]),
        ]),
      ]),
      group(15, 'C', 9999, 'LIN', [
        segment('PIA', 'C', 10),
        segment('IMD', 'C', 25),
        segment('MEA', 'C', 10),
        segment('QTY', 'C', 10),
        segment('ALI', 'C', 10),
        segment('GIN', 'C', 100),
        segment('GIR', 'C', 100),
        segment('DLM', 'C', 100),
        segment('DTM', 'C', 5),
        segment('FTX', 'C', 5),
        segment('MOA', 'C', 5),
        group(16, 'C', 10, 'RFF', [segment('DTM', 'C', 1)]),
        group(17, 'C', 10, 'DGS', [segment('QTY', 'C', 1), segment('FTX', 'C', 5)]),
        group(18, 'C', 100, 'LOC', [
          segment('NAD', 'C', 1),
          segment('DTM', 'C', 1),
          segment('QTY', 'C', 10),
        ]),
        group(19, 'C', 1000, 'SGP', [segment('QTY', 'C', 10)]),
        group(20, 'C', 9999, 'PCI', [
          segment('DTM', 'C', 5),
          segment('MEA', 'C', 10),
          segment('QTY', 'C', 1),
          group(21, 'C', 10, 'GIN', [segment('DLM', 'C', 100)]),
          group(22, 'C', 10, 'HAN', [segment('FTX', 'C', 5), segment('GIN', 'C', 1000)]),
        ]),
        group(23, 'C', 10, 'QVR', [segment('DTM', 'C', 5)]),
      ]),
    ]),
    segment('CNT', 'C', 5),
  ],
}
