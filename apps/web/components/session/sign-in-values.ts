import { signInBodySchema } from '@edi-bridge/contracts'

export type SignInValues = { email: string; password: string }

export type SignInFieldErrors = {
  email: 'emailRequired' | 'emailInvalid' | null
  password: 'passwordRequired' | null
}

export function signInFieldErrors({ email, password }: SignInValues): SignInFieldErrors {
  const trimmed = email.trim()

  return {
    email:
      trimmed === ''
        ? 'emailRequired'
        : signInBodySchema.shape.email.safeParse(trimmed).success
          ? null
          : 'emailInvalid',
    password: password === '' ? 'passwordRequired' : null,
  }
}

export function toSignInBody({ email, password }: SignInValues) {
  return { email: email.trim(), password }
}
