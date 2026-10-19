import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const algorithm = 'aes-256-gcm'

const version = 'v1'

export const secretKeyBytes = 32

export type SecretColumn =
  | 'encryptedCredential'
  | 'encryptedWebhookToken'
  | 'encryptedAuthorization'

export const secretContext = (id: string, column: SecretColumn) => `channels/${id}/${column}`

export interface SecretBox {
  seal: (plaintext: string, context: string) => string
  open: (sealed: string, context: string) => string
}

const encode = (bytes: Buffer) => bytes.toString('base64url')

const decode = (text: string) => Buffer.from(text, 'base64url')

// The context as AAD pins a sealed secret to its row and column.
export function secretBox(key: Buffer): SecretBox {
  if (key.length !== secretKeyBytes) {
    throw new Error(`A secret key has ${secretKeyBytes} bytes`)
  }

  return {
    seal: (plaintext, context) => {
      const iv = randomBytes(12)
      const cipher = createCipheriv(algorithm, key, iv).setAAD(Buffer.from(context))
      const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])

      return [version, encode(iv), encode(cipher.getAuthTag()), encode(ciphertext)].join('.')
    },
    open: (sealed, context) => {
      const [prefix, iv, tag, ciphertext] = sealed.split('.')

      if (prefix !== version || iv === undefined || tag === undefined || ciphertext === undefined) {
        throw new Error('Unknown secret format')
      }

      const decipher = createDecipheriv(algorithm, key, decode(iv))
        .setAAD(Buffer.from(context))
        .setAuthTag(decode(tag))

      return Buffer.concat([decipher.update(decode(ciphertext)), decipher.final()]).toString('utf8')
    },
  }
}
