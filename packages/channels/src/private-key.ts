import { utils } from 'ssh2'

const opensshKey = /-----BEGIN OPENSSH PRIVATE KEY-----([\s\S]+?)-----END OPENSSH PRIVATE KEY-----/

const opensshMagic = 'openssh-key-v1\0'

// Legacy PEM keys mark encryption with a Proc-Type header, PuTTY keys with their Encryption line.
const encryptionHeader = /^(?:Proc-Type: 4,ENCRYPTED|Encryption: (?!none\s*$))/m

const opensshCipher = (blob: Buffer) => {
  const nameStart = opensshMagic.length + 4

  if (blob.length < nameStart || blob.toString('latin1', 0, opensshMagic.length) !== opensshMagic) {
    return undefined
  }

  return blob.toString('latin1', nameStart, nameStart + blob.readUInt32BE(opensshMagic.length))
}

export const encryptedKey = (privateKey: string) => {
  const openssh = opensshKey.exec(privateKey)?.[1]

  return openssh === undefined
    ? encryptionHeader.test(privateKey)
    : (opensshCipher(Buffer.from(openssh, 'base64')) ?? 'none') !== 'none'
}

const probe = Buffer.from('edi-bridge key probe')

// A wrong passphrase can decrypt a legacy PEM key into bytes ssh2 still parses, so the key
// unlocks only when its private part signs what its own public part verifies.
export const unlocksKey = (privateKey: string, passphrase: string | undefined) => {
  const key = utils.parseKey(privateKey, passphrase)

  if (key instanceof Error) {
    return false
  }

  const signature = key.sign(probe)

  return !(signature instanceof Error) && key.verify(probe, signature) === true
}
