import { describe, expect, it } from 'vitest'

import { documentText, lineCount, previewGraph } from './mapping-preview'

const transformId = '0000000b-0000-4000-8000-000000000001'

describe('previewGraph', () => {
  it('leaves out where transforms sit, which changes nothing in the target Document', () => {
    const graph = {
      links: [{ sourcePath: 'despatchNumber', targetPath: 'BGM/1004' }],
      transforms: [
        {
          id: transformId,
          kind: 'constant' as const,
          position: { x: 240, y: 360 },
          config: { value: '351' },
        },
      ],
      transformLinks: [
        {
          from: { kind: 'transform' as const, transformId, output: 'value' },
          to: { kind: 'target' as const, path: 'BGM/C002/1001' },
        },
      ],
    }

    const moved = {
      ...graph,
      transforms: graph.transforms.map((transform) => ({
        ...transform,
        position: { x: 0, y: 120 },
      })),
    }

    expect(previewGraph(moved)).toEqual(previewGraph(graph))
    expect(previewGraph(graph).transforms[0]?.config).toEqual({ value: '351' })
    expect(previewGraph(graph).links).toEqual(graph.links)
  })
})

describe('documentText', () => {
  it('indents JSON and keeps EDIFACT as it is', () => {
    expect(documentText({ format: 'json', content: { orderNumber: 'PO-1', lines: [1] } })).toBe(
      '{\n  "orderNumber": "PO-1",\n  "lines": [\n    1\n  ]\n}',
    )
    expect(documentText({ format: 'edifact', content: "UNH+1'\nUNT+2+1'" })).toBe(
      "UNH+1'\nUNT+2+1'",
    )
  })
})

describe('lineCount', () => {
  it('counts the lines of a text, and none for an empty one', () => {
    expect(lineCount("UNH+1'\nBGM+351'\nUNT+3+1'")).toBe(3)
    expect(lineCount('')).toBe(0)
  })
})
