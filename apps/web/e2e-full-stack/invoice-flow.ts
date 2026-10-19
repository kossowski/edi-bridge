import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

import type { APIRequestContext } from '@playwright/test'

import {
  createChannelEndpoint,
  createDocumentStructureEndpoint,
  createFlowEndpoint,
  createLookupTableEndpoint,
  createMappingEndpoint,
  createTradingPartnerEndpoint,
  currentWorkspaceEndpoint,
  type Endpoint,
  mappingVersionSchema,
  publishMappingDraftEndpoint,
  saveMappingDraftEndpoint,
  toEncodedFile,
  toPath,
  tradingPartnersEndpoint,
  updateCompanyIdentityEndpoint,
} from '@edi-bridge/contracts'

const require = createRequire(import.meta.url)

export const invoiceFixture =
  require.resolve('@edi-bridge/fixtures/documents/valid/invoice-nordlicht-markt.json')

const golden = (name: string) =>
  readFileSync(require.resolve(`@edi-bridge/mapping/golden/${name}`), 'utf8')

// The SFTP service of the full-stack Compose profile, as the worker reaches it.
const sftpInbox = {
  host: 'sftp',
  port: 22,
  username: 'edi_bridge',
  password: 'edi_bridge',
  remotePath: '/upload',
}

const workspaceGln = '4389876511114'

const tradingPartnerInput = {
  name: 'Hanse Retail',
  gln: '4071615111111',
  characterSet: 'UNOC',
  acknowledgementTimeLimitHours: 24,
} as const

export type Api = { request: APIRequestContext; url: string; origin: string }

async function call<Response, Body>(
  api: Api,
  endpoint: Endpoint<Response, undefined, Body>,
  { path = endpoint.path, body }: { path?: string; body?: Body } = {},
): Promise<Response> {
  const response = await api.request.fetch(`${api.url}${path}`, {
    method: endpoint.method,
    headers: { Origin: api.origin },
    ...(endpoint.body && { data: endpoint.body.parse(body) }),
  })

  if (!response.ok()) {
    throw new Error(
      `${endpoint.method} ${path} failed with status ${String(response.status())}: ${await response.text()}`,
    )
  }

  return endpoint.response.parse(await response.json())
}

async function tradingPartnerOf(api: Api) {
  // One shared Trading Partner keeps the interchange file names in the one SFTP folder apart.
  const existing = await call(api, tradingPartnersEndpoint)

  return (
    existing.find(({ gln }) => gln === tradingPartnerInput.gln) ??
    (await call(api, createTradingPartnerEndpoint, { body: tradingPartnerInput }))
  )
}

export async function setUpInvoiceFlow(api: Api) {
  const suffix = crypto.randomUUID().slice(0, 8)
  const workspace = await call(api, currentWorkspaceEndpoint)

  if (workspace.gln === null) {
    await call(api, updateCompanyIdentityEndpoint, { body: { gln: workspaceGln } })
  }

  const tradingPartner = await tradingPartnerOf(api)

  const inbound = await call(api, createChannelEndpoint, {
    body: {
      type: 'webhook',
      direction: 'inbound',
      name: `ERP webhook ${suffix}`,
      tradingPartnerId: null,
      rateLimitPerMinute: 60,
    },
  })

  const outbound = await call(api, createChannelEndpoint, {
    body: {
      type: 'sftp',
      direction: 'outbound',
      name: `Hanse Retail SFTP inbox ${suffix}`,
      tradingPartnerId: tradingPartner.id,
      host: sftpInbox.host,
      port: sftpInbox.port,
      username: sftpInbox.username,
      remotePath: sftpInbox.remotePath,
      authentication: 'password',
      credential: sftpInbox.password,
    },
  })

  await call(api, createDocumentStructureEndpoint, {
    body: {
      name: `ERP invoice ${suffix}`,
      origin: {
        kind: 'jsonDocument',
        document: toEncodedFile(
          'invoic-reference.document.json',
          golden('invoic-reference.document.json'),
        ),
      },
    },
  })

  const units = await call(api, createLookupTableEndpoint, {
    body: {
      name: `Units ${suffix}`,
      kind: 'units',
      scope: { kind: 'tradingPartner', tradingPartnerId: tradingPartner.id },
      entries: [{ sourceCode: 'ST', targetCode: 'PCE' }],
    },
  })

  const reference = mappingVersionSchema.parse(JSON.parse(golden('invoic-reference.mapping.json')))

  const mapping = await call(api, createMappingEndpoint, { body: { messageType: 'INVOIC' } })

  await call(api, saveMappingDraftEndpoint, {
    path: toPath(saveMappingDraftEndpoint.path, { id: mapping.id }),
    body: {
      links: reference.links,
      transforms: reference.transforms.map((transform) =>
        transform.kind === 'lookupTable'
          ? { ...transform, config: { ...transform.config, lookupTableId: units.id } }
          : transform,
      ),
      transformLinks: reference.transformLinks,
    },
  })

  const version = await call(api, publishMappingDraftEndpoint, {
    path: toPath(publishMappingDraftEndpoint.path, { mappingId: mapping.id }),
    body: { changeNote: '', moveFlowIds: [] },
  })

  await call(api, createFlowEndpoint, {
    body: {
      name: `Invoices to Hanse Retail ${suffix}`,
      tradingPartnerId: tradingPartner.id,
      messageType: 'INVOIC',
      mappingVersionId: version.id,
      inboundChannelId: inbound.channel.id,
      destinationChannelId: outbound.channel.id,
    },
  })

  return { inboundChannel: inbound.channel }
}
