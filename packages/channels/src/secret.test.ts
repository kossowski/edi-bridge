import { describe, expect, it } from 'vitest'

import { secretBox, secretKeyBytes } from './index'

const key = Buffer.alloc(secretKeyBytes, 'test-channel-secret-key')

const context = 'channels/3f0c2a9e-1b7d-4e55-9a61-0c8e2d4b7f13/encryptedCredential'

describe('secretBox', () => {
  it('opens what it sealed for the same context', () => {
    const box = secretBox(key)

    const sealed = box.seal('edi-bridge-sftp-password', context)

    expect(sealed).not.toContain('edi-bridge-sftp-password')
    expect(box.open(sealed, context)).toBe('edi-bridge-sftp-password')
  })

  it('refuses to open a secret sealed for another context', () => {
    const box = secretBox(key)

    const sealed = box.seal('edi-bridge-sftp-password', context)

    expect(() => box.open(sealed, 'channels/other/encryptedCredential')).toThrow()
  })

  it('refuses to open a secret sealed with another key', () => {
    const sealed = secretBox(key).seal('edi-bridge-sftp-password', context)

    expect(() =>
      secretBox(Buffer.alloc(secretKeyBytes, 'another-key')).open(sealed, context),
    ).toThrow()
  })

  it('rejects a key of the wrong length', () => {
    expect(() => secretBox(Buffer.alloc(16))).toThrow(`A secret key has ${secretKeyBytes} bytes`)
  })
})
