import type { SftpAuthentication } from '@edi-bridge/contracts'

import { type SecretBox, secretContext } from './secret'

import type { SftpLogin } from './channel-reach'

export interface SftpChannel {
  id: string
  host: string | null
  port: number | null
  username: string | null
  remotePath: string | null
  authentication: SftpAuthentication | null
  encryptedCredential: string | null
}

// The database checks that an SFTP Channel has all its settings, so a missing one is a defect.
export const sftpLogin = (secrets: SecretBox, channel: SftpChannel): SftpLogin => {
  const { id, host, port, username, remotePath, authentication, encryptedCredential } = channel

  if (
    host === null ||
    port === null ||
    username === null ||
    remotePath === null ||
    authentication === null ||
    encryptedCredential === null
  ) {
    throw new Error(`Channel ${id} has no SFTP settings`)
  }

  const credential = secrets.open(encryptedCredential, secretContext(id, 'encryptedCredential'))

  return {
    host,
    port,
    username,
    remotePath,
    credential:
      authentication === 'password' ? { password: credential } : { privateKey: credential },
  }
}
