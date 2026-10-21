import { utils } from 'ssh2'

import type { SftpCredential } from './channel-reach'

const opensshKey = /-----BEGIN OPENSSH PRIVATE KEY-----([\s\S]+?)-----END OPENSSH PRIVATE KEY-----/

const opensshMagic = 'openssh-key-v1\0'

// Only formats ssh2 1.17 parses: it reads neither PPK v3 nor PPK v2 ECDSA or Ed25519 keys.
const encryptionHeader =
  /^(?:-----BEGIN (?:RSA|DSA|EC) PRIVATE KEY-----\r?\nProc-Type: 4,ENCRYPTED|PuTTY-User-Key-File-2: ssh-(?:rsa|dss)\r?\nEncryption: aes256-cbc)\r?$/m

const opensshCipher = (blob: Buffer) => {
  const nameStart = opensshMagic.length + 4

  if (blob.length < nameStart || blob.toString('latin1', 0, opensshMagic.length) !== opensshMagic) {
    return undefined
  }

  return blob.toString('latin1', nameStart, nameStart + blob.readUInt32BE(opensshMagic.length))
}

const encryptedKey = (privateKey: string) => {
  const openssh = opensshKey.exec(privateKey)?.[1]

  return openssh === undefined
    ? encryptionHeader.test(privateKey)
    : (opensshCipher(Buffer.from(openssh, 'base64')) ?? 'none') !== 'none'
}

const probe = Buffer.from('edi-bridge key probe')

// A wrong passphrase can decrypt a legacy PEM key into another key ssh2 still parses.
const unlocksKey = (privateKey: string, passphrase: string | undefined) => {
  const key = utils.parseKey(privateKey, passphrase)

  if (key instanceof Error) {
    return false
  }

  const signature = key.sign(probe)

  return !(signature instanceof Error) && key.verify(probe, signature) === true
}

export const lockedKey = (credential: SftpCredential) =>
  'privateKey' in credential &&
  encryptedKey(credential.privateKey) &&
  !unlocksKey(credential.privateKey, credential.passphrase)
