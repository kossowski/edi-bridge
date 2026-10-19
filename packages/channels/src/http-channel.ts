import { type SecretBox, secretContext } from './secret'

import type { HttpDestination } from './channel-reach'

export interface HttpChannel {
  id: string
  url: string | null
  encryptedAuthorization: string | null
}

// The database checks that an HTTP Channel has its URL, so a missing one is a defect.
export const httpDestination = (secrets: SecretBox, channel: HttpChannel): HttpDestination => {
  const { id, url, encryptedAuthorization } = channel

  if (url === null) {
    throw new Error(`Channel ${id} has no HTTP settings`)
  }

  return {
    url,
    authorization:
      encryptedAuthorization === null
        ? null
        : secrets.open(encryptedAuthorization, secretContext(id, 'encryptedAuthorization')),
  }
}
