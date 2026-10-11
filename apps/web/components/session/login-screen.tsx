'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { type FormEvent, useId, useRef, useState } from 'react'

import { TextField } from '@/components/form-field'
import { focusMainContentOnNextPage } from '@/components/main-content-focus'
import { isUnauthorized, signIn, signInToShowcase } from '@/lib/api/client'
import { sessionQuery } from '@/lib/api/queries'
import { Button } from '@edi-bridge/ui/components/button'

import type { SignedIn } from '@edi-bridge/contracts'

import { type SignInValues, signInFieldErrors, toSignInBody } from './sign-in-values'

function useEnterWorkspace<Variables>(signInWith: (variables: Variables) => Promise<SignedIn>) {
  const queryClient = useQueryClient()
  const router = useRouter()

  return useMutation({
    mutationFn: async (variables: Variables) => {
      await signInWith(variables)
      queryClient.clear()
      await queryClient.prefetchQuery(sessionQuery)
    },
    onSuccess: () => {
      focusMainContentOnNextPage()
      router.replace('/')
    },
  })
}

function isEntering(mutation: { isPending: boolean; isSuccess: boolean }) {
  return mutation.isPending || mutation.isSuccess
}

export function LoginScreen() {
  const t = useTranslations('Login')
  const id = useId()
  const emailRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)
  const [values, setValues] = useState<SignInValues>({ email: '', password: '' })
  const [submitted, setSubmitted] = useState(false)

  const credentialsSignIn = useEnterWorkspace(signIn)
  const showcaseSignIn = useEnterWorkspace(signInToShowcase)
  const pending = isEntering(credentialsSignIn) || isEntering(showcaseSignIn)

  const fieldErrors = signInFieldErrors(values)
  const emailError = submitted && fieldErrors.email ? t(`errors.${fieldErrors.email}`) : null

  const passwordError =
    submitted && fieldErrors.password ? t(`errors.${fieldErrors.password}`) : null

  const serverError = credentialsSignIn.isError
    ? t(isUnauthorized(credentialsSignIn.error) ? 'errors.wrongCredentials' : 'errors.failed')
    : showcaseSignIn.isError
      ? t('errors.showcaseFailed')
      : null

  function change(field: keyof SignInValues, value: string) {
    setValues((current) => ({ ...current, [field]: value }))
    credentialsSignIn.reset()
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitted(true)
    showcaseSignIn.reset()

    if (fieldErrors.email) {
      emailRef.current?.focus()
    } else if (fieldErrors.password) {
      passwordRef.current?.focus()
    } else {
      credentialsSignIn.mutate(toSignInBody(values))
    }
  }

  return (
    <div className="flex w-full max-w-sm flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <h1 id={`${id}-title`} className="text-2xl font-semibold tracking-tight">
          {t('title')}
        </h1>
        <p className="text-muted-foreground text-sm">{t('description')}</p>
      </div>
      <form
        noValidate
        aria-labelledby={`${id}-title`}
        className="flex flex-col gap-4"
        onSubmit={submit}>
        <TextField
          id={`${id}-email`}
          autoComplete="email"
          error={emailError}
          label={t('email')}
          name="email"
          ref={emailRef}
          spellCheck={false}
          type="email"
          value={values.email}
          onChange={(value) => change('email', value)}
        />
        <TextField
          id={`${id}-password`}
          autoComplete="current-password"
          error={passwordError}
          label={t('password')}
          name="password"
          ref={passwordRef}
          type="password"
          value={values.password}
          onChange={(value) => change('password', value)}
        />
        <div role="alert" className="text-sm text-red-800 empty:hidden dark:text-red-300">
          {serverError}
        </div>
        <Button disabled={pending} type="submit" className="w-full">
          {isEntering(credentialsSignIn) ? t('submitting') : t('submit')}
        </Button>
      </form>
      <div className="text-muted-foreground flex items-center gap-3 text-xs uppercase">
        <span aria-hidden className="bg-border h-px flex-1" />
        {t('or')}
        <span aria-hidden className="bg-border h-px flex-1" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Button
          disabled={pending}
          type="button"
          variant="outline"
          aria-describedby={`${id}-showcase`}
          className="w-full"
          onClick={() => {
            setSubmitted(false)
            credentialsSignIn.reset()
            showcaseSignIn.mutate(undefined)
          }}>
          {isEntering(showcaseSignIn) ? t('showcasePending') : t('showcase')}
        </Button>
        <p id={`${id}-showcase`} className="text-muted-foreground text-center text-sm">
          {t('showcaseDescription')}
        </p>
      </div>
      <p className="text-muted-foreground border-t pt-4 text-sm">{t('invitedByOperator')}</p>
    </div>
  )
}
