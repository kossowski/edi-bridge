import ssh2 from 'ssh2'
import { describe, expect, it } from 'vitest'

import { sshKeyPair } from './testing'

describe('sshKeyPair', () => {
  // About one in 256 ssh2 Ed25519 pairs is malformed, so a few thousand catch it every time.
  it('generates key pairs that ssh2 can parse', () => {
    const malformed = Array.from({ length: 2000 }, () => sshKeyPair()).filter(
      (pair) => ssh2.utils.parseKey(pair.private) instanceof Error,
    )

    expect(malformed).toEqual([])
  })
})
