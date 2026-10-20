import { describe, expect, it } from 'vitest'

import { maxChannelNameLength, maxFlowNameLength } from '@edi-bridge/contracts'

import { toFormValues } from '../channels/channel-form-values'
import { type PlanChannel, setupPlan, type SetupContext } from './partner-setup-plan'
import { type WizardResult } from './partner-wizard-state'

const erpDelivery = {
  id: 'erp-delivery',
  name: 'ERP HTTP delivery',
  direction: 'outbound',
  tradingPartnerId: null,
} as const satisfies PlanChannel

const erpWebhook = {
  id: 'erp-webhook',
  name: 'ERP webhook',
  direction: 'inbound',
  tradingPartnerId: null,
} as const satisfies PlanChannel

const otherPartnerInbox = {
  id: 'other-inbox',
  name: 'Other SFTP inbox',
  direction: 'inbound',
  tradingPartnerId: '10000000-0000-4000-8000-000000000001',
} as const satisfies PlanChannel

const ordersVersion = {
  id: 'orders-v3',
  mappingId: 'orders',
  mappingName: 'ORDERS to ERP JSON',
  version: 3,
  publishedAt: '2026-03-02T09:00:00.000Z',
}

const invoicVersion = { ...ordersVersion, id: 'invoic-v1', mappingId: 'invoic', version: 1 }

const sftp = { way: 'sftp', values: toFormValues() } as const

const context: SetupContext<PlanChannel> = {
  channels: [erpDelivery, erpWebhook, otherPartnerInbox],
  mappingVersions: [ordersVersion, invoicVersion],
  documentStructures: [{ id: 'erp-json' }],
  names: {
    connection: (kind) => `Kieler Kontor ${kind}`,
    route: (messageType) => `${messageType} route`,
  },
}

const result: WizardResult = {
  partner: { name: 'Kieler Kontor', gln: '0234567890129' },
  documents: ['ORDERS', 'INVOIC'],
  connections: { inbound: sftp, outbound: { way: 'web', values: toFormValues() } },
  mappings: {
    ORDERS: { way: 'existing', mappingVersionId: ordersVersion.id },
    INVOIC: { way: 'existing', mappingVersionId: invoicVersion.id },
  },
}

describe('setupPlan', () => {
  it('plans a document route for each document when everything is in place', () => {
    const plan = setupPlan(result, context)
    const [inbound, outbound] = plan.connections

    expect([inbound?.direction, outbound?.direction]).toEqual(['inbound', 'outbound'])
    expect(plan.documents).toEqual([
      {
        messageType: 'ORDERS',
        route: {
          name: 'ORDERS route',
          direction: 'inbound',
          partnerConnection: inbound,
          ownChannel: erpDelivery,
          mappingVersion: ordersVersion,
        },
      },
      {
        messageType: 'INVOIC',
        route: {
          name: 'INVOIC route',
          direction: 'outbound',
          partnerConnection: outbound,
          ownChannel: erpWebhook,
          mappingVersion: invoicVersion,
        },
      },
    ])
    expect(plan.mappingDrafts).toEqual([])
  })

  it('keeps the partner with its GLN, or without one when it is added later', () => {
    expect(setupPlan(result, context).partner).toEqual(result.partner)
    expect(
      setupPlan({ ...result, partner: { name: 'Kieler Kontor', gln: null } }, context).partner,
    ).toEqual({ name: 'Kieler Kontor', gln: null })
  })

  it('names each connection to create after its kind and keeps its details', () => {
    const plan = setupPlan(result, context)

    expect(
      plan.connections.map(({ direction, kind, values }) => [direction, kind, values.name]),
    ).toEqual([
      ['inbound', 'sftp-inbound', 'Kieler Kontor sftp-inbound'],
      ['outbound', 'http-outbound', 'Kieler Kontor http-outbound'],
    ])
    expect(plan.connections[1]?.values.kind).toBe('http-outbound')
  })

  it('cuts a long suggested connection name to the allowed length', () => {
    const plan = setupPlan(result, {
      ...context,
      names: { ...context.names, connection: () => 'x'.repeat(100) },
    })

    expect(plan.connections[0]?.values.name).toHaveLength(maxChannelNameLength)
  })

  it('cuts a long document route name to the allowed length, as it is created', () => {
    const name = 'K'.repeat(70)

    const plan = setupPlan(
      { ...result, partner: { ...result.partner, name } },
      { ...context, names: { ...context.names, route: () => `Purchase orders from ${name}` } },
    )

    const expected = `Purchase orders from ${name}`.slice(0, maxFlowNameLength)

    expect(expected).toHaveLength(maxFlowNameLength)
    expect(plan.documents[0]).toMatchObject({ route: { name: expected } })
  })

  it('creates no connection for a postponed direction and leaves its documents', () => {
    const plan = setupPlan(
      { ...result, connections: { ...result.connections, inbound: { way: 'ask' } } },
      context,
    )

    expect(plan.connections.map(({ direction }) => direction)).toEqual(['outbound'])
    expect(plan.documents[0]).toEqual({ messageType: 'ORDERS', reasons: ['connectionPostponed'] })
    expect(plan.documents[1]).toHaveProperty('route')
  })

  it('plans a mapping for each AI draft and leaves its document route until it is published', () => {
    const plan = setupPlan(
      { ...result, mappings: { ...result.mappings, INVOIC: { way: 'ai' } } },
      context,
    )

    expect(plan.mappingDrafts).toEqual([{ messageType: 'INVOIC', documentStructureId: 'erp-json' }])
    expect(plan.skippedMappingDrafts).toEqual([])
    expect(plan.documents[1]).toEqual({ messageType: 'INVOIC', reasons: ['mappingDraft'] })
  })

  it('skips each AI draft when the workspace has no document structure or several', () => {
    const drafts: WizardResult = {
      ...result,
      mappings: { ORDERS: { way: 'ai' }, INVOIC: { way: 'ai' } },
    }

    const none = setupPlan(drafts, { ...context, documentStructures: [] })

    expect(none.mappingDrafts).toEqual([])
    expect(none.skippedMappingDrafts).toEqual([
      { messageType: 'ORDERS', reason: 'noDocumentStructure' },
      { messageType: 'INVOIC', reason: 'noDocumentStructure' },
    ])

    const several = setupPlan(drafts, {
      ...context,
      documentStructures: [{ id: 'erp-json' }, { id: 'erp-csv' }],
    })

    expect(several.mappingDrafts).toEqual([])
    expect(several.skippedMappingDrafts).toEqual([
      { messageType: 'ORDERS', reason: 'severalDocumentStructures' },
      { messageType: 'INVOIC', reason: 'severalDocumentStructures' },
    ])
    expect(several.documents.map((document) => 'reasons' in document && document.reasons)).toEqual([
      ['mappingDraft'],
      ['mappingDraft'],
    ])
  })

  it('leaves a document whose mapping is chosen later or no longer offered', () => {
    const plan = setupPlan(
      {
        ...result,
        mappings: {
          ORDERS: { way: 'later' },
          INVOIC: { way: 'existing', mappingVersionId: 'gone' },
        },
      },
      context,
    )

    expect(plan.documents).toEqual([
      { messageType: 'ORDERS', reasons: ['mappingLater'] },
      { messageType: 'INVOIC', reasons: ['mappingLater'] },
    ])
  })

  it('leaves a document when none or several of your own connections fit', () => {
    const plan = setupPlan(result, {
      ...context,
      channels: [erpDelivery, { ...erpDelivery, id: 'second', name: 'Second ERP' }],
    })

    expect(plan.documents).toEqual([
      { messageType: 'ORDERS', reasons: ['severalOwnConnections'] },
      { messageType: 'INVOIC', reasons: ['noOwnConnection'] },
    ])
  })

  it('ignores the connections of other partners as your own', () => {
    const plan = setupPlan(result, { ...context, channels: [erpDelivery, otherPartnerInbox] })

    expect(plan.documents[1]).toEqual({ messageType: 'INVOIC', reasons: ['noOwnConnection'] })
  })

  it('lists every reason a document is left for the partner page', () => {
    const plan = setupPlan(
      {
        ...result,
        connections: { inbound: { way: 'ask' } },
        documents: ['ORDERS'],
        mappings: { ORDERS: { way: 'ai' } },
      },
      { ...context, channels: [] },
    )

    expect(plan.documents).toEqual([
      {
        messageType: 'ORDERS',
        reasons: ['connectionPostponed', 'noOwnConnection', 'mappingDraft'],
      },
    ])
  })
})
