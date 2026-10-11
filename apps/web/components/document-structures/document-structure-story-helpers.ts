import { decodeBase64 } from '@/components/document-structures/document-file'

import type { EncodedFile } from '@edi-bridge/contracts'

export function toFile({ fileName, content }: EncodedFile) {
  return new File([decodeBase64(content)], fileName)
}
