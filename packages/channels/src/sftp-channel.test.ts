import { describe, expect, it } from 'vitest'

import { sftpCredential } from './index'

describe('sftpCredential', () => {
  it('logs in with a password, which takes no passphrase', () => {
    expect(sftpCredential('password', 'sftp-password', 'key-passphrase')).toEqual({
      password: 'sftp-password',
    })
  })

  it('logs in with a private key that has no passphrase', () => {
    expect(sftpCredential('privateKey', 'private-key')).toEqual({ privateKey: 'private-key' })
    expect(sftpCredential('privateKey', 'private-key', null)).toEqual({
      privateKey: 'private-key',
    })
  })

  it('logs in with a private key and its passphrase', () => {
    expect(sftpCredential('privateKey', 'private-key', 'key-passphrase')).toEqual({
      privateKey: 'private-key',
      passphrase: 'key-passphrase',
    })
  })
})
