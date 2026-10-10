import type { DocumentContent, MappingGraph } from '@edi-bridge/contracts'

const origin = { x: 0, y: 0 }

// Moving a transform node changes nothing in the target Document, so it starts no new preview.
export function previewGraph({ links, transforms, transformLinks }: MappingGraph): MappingGraph {
  return {
    links,
    transforms: transforms.map((transform) => ({ ...transform, position: origin })),
    transformLinks,
  }
}

export function documentText(document: DocumentContent) {
  return document.format === 'json' ? JSON.stringify(document.content, null, 2) : document.content
}

export function lineCount(text: string) {
  return text === '' ? 0 : text.split('\n').length
}
