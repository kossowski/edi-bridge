import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'

import { unlockedKey } from './private-key'
import { legacyPemKeyPair, sshKeyPair, wrongPassphrase } from './testing'

const passphrase = 'edi-bridge-key-passphrase'

const ppkKey = (version: 2 | 3, keyType: string) =>
  [
    `PuTTY-User-Key-File-${String(version)}: ${keyType}`,
    'Encryption: aes256-cbc',
    'Comment: test key',
    'Public-Lines: 1',
    randomBytes(51).toString('base64'),
    ...(version === 3
      ? [
          'Key-Derivation: Argon2id',
          'Argon2-Memory: 8192',
          'Argon2-Passes: 13',
          'Argon2-Parallelism: 1',
          `Argon2-Salt: ${randomBytes(16).toString('hex')}`,
        ]
      : []),
    'Private-Lines: 1',
    randomBytes(48).toString('base64'),
    `Private-MAC: ${randomBytes(version === 3 ? 32 : 20).toString('hex')}`,
  ].join('\n')

const opened = (unlocked: ReturnType<typeof unlockedKey>) =>
  'key' in unlocked && unlocked.key.isPrivateKey()

describe('unlockedKey', () => {
  it('opens an unencrypted key', () => {
    expect(opened(unlockedKey({ privateKey: sshKeyPair().private }))).toBe(true)
  })

  it('opens an OpenSSH key with its passphrase', () => {
    expect(opened(unlockedKey({ privateKey: sshKeyPair(passphrase).private, passphrase }))).toBe(
      true,
    )
  })

  it('opens a legacy PEM key with its passphrase', () => {
    expect(
      opened(unlockedKey({ privateKey: legacyPemKeyPair(passphrase).private, passphrase })),
    ).toBe(true)
  })

  it('rejects the passphrase of an OpenSSH key with a wrong passphrase', () => {
    expect(
      unlockedKey({ privateKey: sshKeyPair(passphrase).private, passphrase: wrongPassphrase }),
    ).toEqual({ reason: 'passphraseRejected' })
  })

  it('rejects the passphrase of a legacy PEM key without a passphrase', () => {
    expect(unlockedKey({ privateKey: legacyPemKeyPair(passphrase).private })).toEqual({
      reason: 'passphraseRejected',
    })
  })

  it('rejects the passphrase of a PPK v2 RSA key that its passphrase does not decrypt', () => {
    expect(unlockedKey({ privateKey: ppkKey(2, 'ssh-rsa'), passphrase })).toEqual({
      reason: 'passphraseRejected',
    })
  })

  it('rejects the login of a PPK v2 Ed25519 key, since ssh2 cannot read it', () => {
    expect(unlockedKey({ privateKey: ppkKey(2, 'ssh-ed25519'), passphrase })).toEqual({
      reason: 'loginRejected',
    })
  })

  it('rejects the login of a PPK v3 key, since ssh2 cannot read it', () => {
    expect(unlockedKey({ privateKey: ppkKey(3, 'ssh-rsa'), passphrase })).toEqual({
      reason: 'loginRejected',
    })
  })

  it('rejects the login of a public key', () => {
    expect(unlockedKey({ privateKey: sshKeyPair().public })).toEqual({ reason: 'loginRejected' })
  })
})
