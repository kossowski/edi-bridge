export type RunMappingFilterCase = {
  mappings: readonly string[]
  mappingVersions: readonly { key: string; mapping: string }[]
  flows: readonly { key: string; pinnedMappingVersion: string }[]
  runs: readonly { key: string; flow: string; recordedMappingVersion: string | null }[]
  filters: readonly { mappings: readonly string[]; runs: readonly string[] }[]
}

// Keys stand for ids each consumer seeds; arrays run in publishing and receiving order.
export const runMappingFilterCase = {
  mappings: ['orders', 'ordersV2'],
  mappingVersions: [
    { key: 'orders1', mapping: 'orders' },
    { key: 'orders2', mapping: 'orders' },
    { key: 'ordersV2First', mapping: 'ordersV2' },
  ],
  flows: [{ key: 'inbound', pinnedMappingVersion: 'ordersV2First' }],
  runs: [
    { key: 'mappedWithOrders1', flow: 'inbound', recordedMappingVersion: 'orders1' },
    { key: 'mappedWithOrders2', flow: 'inbound', recordedMappingVersion: 'orders2' },
    { key: 'notYetProcessed', flow: 'inbound', recordedMappingVersion: null },
  ],
  filters: [
    { mappings: ['orders'], runs: ['mappedWithOrders1', 'mappedWithOrders2'] },
    { mappings: ['ordersV2'], runs: ['notYetProcessed'] },
    {
      mappings: ['orders', 'ordersV2'],
      runs: ['mappedWithOrders1', 'mappedWithOrders2', 'notYetProcessed'],
    },
  ],
} as const satisfies RunMappingFilterCase
