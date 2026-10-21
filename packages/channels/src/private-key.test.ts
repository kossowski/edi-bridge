import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'

import { lockedKey } from './private-key'
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

describe('lockedKey', () => {
  it('leaves a password to the login', () => {
    expect(lockedKey({ password: wrongPassphrase })).toBe(false)
  })

  it('leaves an unencrypted key to the login', () => {
    expect(lockedKey({ privateKey: sshKeyPair().private })).toBe(false)
  })

  it('opens an OpenSSH key with its passphrase', () => {
    expect(lockedKey({ privateKey: sshKeyPair(passphrase).private, passphrase })).toBe(false)
  })

  it('locks an OpenSSH key with a wrong passphrase', () => {
    expect(
      lockedKey({ privateKey: sshKeyPair(passphrase).private, passphrase: wrongPassphrase }),
    ).toBe(true)
  })

  it('locks a legacy PEM key without a passphrase', () => {
    expect(lockedKey({ privateKey: legacyPemKeyPair(passphrase).private })).toBe(true)
  })

  it('locks a PPK v2 RSA key that its passphrase does not decrypt', () => {
    expect(lockedKey({ privateKey: ppkKey(2, 'ssh-rsa'), passphrase })).toBe(true)
  })

  it('leaves a PPK v2 Ed25519 key to the login, since ssh2 cannot read it', () => {
    expect(lockedKey({ privateKey: ppkKey(2, 'ssh-ed25519'), passphrase })).toBe(false)
  })

  it('leaves a PPK v3 key to the login, since ssh2 cannot read it', () => {
    expect(lockedKey({ privateKey: ppkKey(3, 'ssh-rsa'), passphrase })).toBe(false)
  })
})
