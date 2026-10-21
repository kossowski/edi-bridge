import ssh2 from 'ssh2'
import { describe, expect, it } from 'vitest'

import { keyWithForeignPublicPart, sshKeyPair } from './testing'

describe('sshKeyPair', () => {
  // About one in 256 ssh2 Ed25519 pairs is malformed, so a few thousand catch it every time.
  it('generates key pairs that ssh2 can parse', () => {
    const malformed = Array.from({ length: 2000 }, () => sshKeyPair()).filter(
      (pair) => ssh2.utils.parseKey(pair.private) instanceof Error,
    )

    expect(malformed).toEqual([])
  })
})

const probe = Buffer.from('probe')

describe('keyWithForeignPublicPart', () => {
  it('generates keys that ssh2 parses with the passphrase but that cannot sign', () => {
    const signing = Array.from({ length: 20 }, () => keyWithForeignPublicPart()).map(
      ({ privateKey, passphrase }) => {
        const key = ssh2.utils.parseKey(privateKey, passphrase)

        if (key instanceof Error) {
          return key.message
        }

        const signature = key.sign(probe)

        return !(signature instanceof Error) && key.verify(probe, signature)
      },
    )

    expect(signing.filter((signs) => signs !== false)).toEqual([])
  })
})
