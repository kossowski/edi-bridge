import type { HostKeyFingerprint, SftpAuthentication } from '@edi-bridge/contracts'

import { type SecretBox, secretContext } from './secret'

import type { SftpCredential, SftpLogin } from './channel-reach'

export interface SftpChannel {
  id: string
  host: string | null
  port: number | null
  username: string | null
  remotePath: string | null
  authentication: SftpAuthentication | null
  encryptedCredential: string | null
  encryptedPassphrase: string | null
  hostKeyFingerprint: HostKeyFingerprint | null
}

export const sftpCredential = (
  authentication: SftpAuthentication,
  credential: string,
  passphrase: string | null = null,
): SftpCredential =>
  authentication === 'password'
    ? { password: credential }
    : { privateKey: credential, ...(passphrase !== null && { passphrase }) }

// The database checks that an SFTP Channel has all its settings, so a missing one is a defect.
export const sftpLogin = (secrets: SecretBox, channel: SftpChannel): SftpLogin => {
  const {
    id,
    host,
    port,
    username,
    remotePath,
    authentication,
    encryptedCredential,
    encryptedPassphrase,
    hostKeyFingerprint,
  } = channel

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

  const passphrase =
    encryptedPassphrase === null
      ? null
      : secrets.open(encryptedPassphrase, secretContext(id, 'encryptedPassphrase'))

  return {
    host,
    port,
    username,
    remotePath,
    hostKeyFingerprint,
    credential: sftpCredential(authentication, credential, passphrase),
  }
}
