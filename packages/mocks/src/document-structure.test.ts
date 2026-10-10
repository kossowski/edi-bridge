import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import {
  type DocumentStructure,
  documentStructureEndpoint,
  type DocumentStructureNode,
  toPath,
} from '@edi-bridge/contracts'

import {
  createDocumentStructure,
  documentStructureHandler,
  documentStructureLeaves,
  seedDocumentStructures,
} from './document-structure'

const apiUrl = 'http://api.test'

const server = setupServer()

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))

afterEach(() => server.resetHandlers())

afterAll(() => server.close())

async function getStructure(id: string) {
  return fetch(`${apiUrl}${toPath(documentStructureEndpoint.path, { id })}`)
}

function childrenOf(node: DocumentStructureNode): DocumentStructureNode[] {
  switch (node.kind) {
    case 'field':
      return []
    case 'object':
      return node.children
    case 'array':
      return [node.items]
  }
}

function nodeAt(
  nodes: ReadonlyArray<DocumentStructureNode>,
  path: string,
): DocumentStructureNode | undefined {
  for (const node of nodes) {
    const found = node.path === path ? node : nodeAt(childrenOf(node), path)

    if (found) {
      return found
    }
  }

  return undefined
}

const purchaseOrder = seedDocumentStructures.find(({ name }) => name === 'ERP purchase order')!

describe('GET /document-structures/:id', () => {
  it('serves a seed structure with nested objects and repeating line items', async () => {
    server.use(documentStructureHandler(apiUrl))

    const response = await getStructure(purchaseOrder.id)
    const structure = documentStructureEndpoint.response.parse(await response.json())

    expect(nodeAt(structure.children, 'buyer.gln')).toMatchObject({ kind: 'field', type: 'string' })
    expect(nodeAt(structure.children, 'lines[]')).toMatchObject({ kind: 'array', required: true })
    expect(nodeAt(structure.children, 'lines[].quantity')).toMatchObject({ type: 'number' })
  })

  it('answers 404 for an unknown structure', async () => {
    server.use(documentStructureHandler(apiUrl))

    expect((await getStructure(crypto.randomUUID())).status).toBe(404)
  })

  it('serves a large generated structure', async () => {
    const large = createDocumentStructure({ fieldCount: 400 })
    server.use(documentStructureHandler(apiUrl, [large]))

    const response = await getStructure(large.id)
    const structure = documentStructureEndpoint.response.parse(await response.json())

    expect(documentStructureLeaves(structure)).toHaveLength(400)
  })
})

describe('createDocumentStructure', () => {
  const structure = createDocumentStructure({ fieldCount: 120 })

  it('nests objects and repeating arrays', () => {
    const kinds = new Set<string>()

    const visit = (nodes: ReadonlyArray<DocumentStructureNode>, depth: number) => {
      for (const node of nodes) {
        kinds.add(`${node.kind}@${Math.min(depth, 2)}`)
        visit(childrenOf(node), depth + 1)
      }
    }

    visit(structure.children, 0)

    expect(kinds).toContain('array@0')
    expect(kinds).toContain('object@0')
    expect(kinds).toContain('field@2')
  })

  it('gives every field a unique path', () => {
    const paths = documentStructureLeaves(structure).map(({ path }) => path)

    expect(new Set(paths).size).toBe(paths.length)
  })

  it('generates the same structure for the same seed', () => {
    expect(createDocumentStructure({ fieldCount: 30 })).toEqual(
      createDocumentStructure({ fieldCount: 30 }),
    )
  })
})

describe('seed Document Structures', () => {
  it.each(seedDocumentStructures.map((structure) => [structure.name, structure] as const))(
    '%s has unique field paths',
    (_, structure: DocumentStructure) => {
      const paths = documentStructureLeaves(structure).map(({ path }) => path)

      expect(paths.length).toBeGreaterThan(5)
      expect(new Set(paths).size).toBe(paths.length)
    },
  )
})
