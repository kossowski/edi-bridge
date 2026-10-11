import { describe, expect, it } from 'vitest'

import { signInFieldErrors, toSignInBody } from './sign-in-values'

describe('signInFieldErrors', () => {
  it('asks for both fields when the form is empty', () => {
    expect(signInFieldErrors({ email: ' ', password: '' })).toEqual({
      email: 'emailRequired',
      password: 'passwordRequired',
    })
  })

  it('rejects an email address without a domain', () => {
    expect(signInFieldErrors({ email: 'ilka@', password: 'secret' }).email).toBe('emailInvalid')
  })

  it('accepts a padded email address and any non-empty password', () => {
    expect(signInFieldErrors({ email: ' ilka@example.com ', password: ' ' })).toEqual({
      email: null,
      password: null,
    })
  })
})

describe('toSignInBody', () => {
  it('trims the email address but keeps the password as typed', () => {
    expect(toSignInBody({ email: ' ilka@example.com ', password: ' pw ' })).toEqual({
      email: 'ilka@example.com',
      password: ' pw ',
    })
  })
})
