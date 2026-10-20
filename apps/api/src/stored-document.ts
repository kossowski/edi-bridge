import { readableOf } from '@edi-bridge/edifact'
import { decodeDocument } from '@edi-bridge/pipeline'

type StoredDocument = { id: string; content: string | null; bytes: Buffer | null }

// Receipt keeps the bytes of an Interchange not valid in its character set; U+FFFD marks those here.
export const readableTextOf = ({ id, content, bytes }: StoredDocument) => {
  if (content !== null) {
    return content
  }

  if (bytes === null) {
    throw new Error(`Document ${id} has neither content nor bytes`)
  }

  return readableOf(decodeDocument(bytes))
}
