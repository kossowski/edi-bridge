'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { type ComponentProps, type FormEvent, useId, useRef, useState } from 'react'

import { isUnauthorized, signIn, signInToShowcase } from '@/lib/api/client'
import { sessionQuery } from '@/lib/api/queries'
import { Button } from '@edi-bridge/ui/components/button'
import { Input } from '@edi-bridge/ui/components/input'

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
    onSuccess: () => router.replace('/'),
  })
}

function LoginField({
  id,
  label,
  error,
  ...inputProps
}: {
  id: string
  label: string
  error: string | null
} & Omit<ComponentProps<typeof Input>, 'id'>) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <Input
        id={id}
        aria-describedby={error ? `${id}-error` : undefined}
        aria-invalid={error !== null}
        {...inputProps}
      />
      {error && (
        <p id={`${id}-error`} className="text-sm text-red-800 dark:text-red-300">
          {error}
        </p>
      )}
    </div>
  )
}

export function LoginScreen() {
  const t = useTranslations('Login')
  const id = useId()
  const emailRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)
  const [values, setValues] = useState<SignInValues>({ email: '', password: '' })
  const [submitted, setSubmitted] = useState(false)

  const credentials = useEnterWorkspace(signIn)
  const showcase = useEnterWorkspace(signInToShowcase)

  const pending =
    credentials.isPending || showcase.isPending || credentials.isSuccess || showcase.isSuccess

  const fieldErrors = signInFieldErrors(values)
  const emailError = submitted && fieldErrors.email ? t(`errors.${fieldErrors.email}`) : null

  const passwordError =
    submitted && fieldErrors.password ? t(`errors.${fieldErrors.password}`) : null

  const serverError = credentials.isError
    ? t(isUnauthorized(credentials.error) ? 'errors.wrongCredentials' : 'errors.failed')
    : showcase.isError
      ? t('errors.liveDemoFailed')
      : null

  function change(field: keyof SignInValues, value: string) {
    setValues((current) => ({ ...current, [field]: value }))
    credentials.reset()
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitted(true)
    showcase.reset()

    if (fieldErrors.email) {
      emailRef.current?.focus()
    } else if (fieldErrors.password) {
      passwordRef.current?.focus()
    } else {
      credentials.mutate(toSignInBody(values))
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
        <LoginField
          id={`${id}-email`}
          autoComplete="email"
          error={emailError}
          label={t('email')}
          name="email"
          ref={emailRef}
          spellCheck={false}
          type="email"
          value={values.email}
          onChange={(event) => change('email', event.target.value)}
        />
        <LoginField
          id={`${id}-password`}
          autoComplete="current-password"
          error={passwordError}
          label={t('password')}
          name="password"
          ref={passwordRef}
          type="password"
          value={values.password}
          onChange={(event) => change('password', event.target.value)}
        />
        <div role="alert" className="text-sm text-red-800 empty:hidden dark:text-red-300">
          {serverError}
        </div>
        <Button disabled={pending} type="submit" className="w-full">
          {credentials.isPending || credentials.isSuccess ? t('submitting') : t('submit')}
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
          aria-describedby={`${id}-live-demo`}
          className="w-full"
          onClick={() => {
            setSubmitted(false)
            credentials.reset()
            showcase.mutate(undefined)
          }}>
          {showcase.isPending || showcase.isSuccess ? t('liveDemoPending') : t('liveDemo')}
        </Button>
        <p id={`${id}-live-demo`} className="text-muted-foreground text-center text-sm">
          {t('liveDemoDescription')}
        </p>
      </div>
      <p className="text-muted-foreground border-t pt-4 text-sm">{t('noAccount')}</p>
    </div>
  )
}
