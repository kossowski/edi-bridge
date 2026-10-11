'use client'

import {
  CheckmarkCircle02Icon,
  Clock01Icon,
  PlayIcon,
  Wrench01Icon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { type FormEvent, useId, useRef, useState } from 'react'

import { PasswordField, TextField } from '@/components/form-field'
import { focusMainContentOnNextPage } from '@/components/main-content-focus'
import { isUnauthorized, signIn, signInToShowcase } from '@/lib/api/client'
import { sessionQuery } from '@/lib/api/queries'
import { Button } from '@edi-bridge/ui/components/button'
import { Card, CardContent, CardDescription, CardHeader } from '@edi-bridge/ui/components/card'

import type { SignedIn } from '@edi-bridge/contracts'

import { type SignInValues, signInFieldErrors, toSignInBody } from './sign-in-values'

const points = [
  { key: 'erp', icon: CheckmarkCircle02Icon },
  { key: 'nextStep', icon: Wrench01Icon },
  { key: 'orders', icon: Clock01Icon },
] as const

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

  const credentialsError = credentialsSignIn.isError
    ? t(isUnauthorized(credentialsSignIn.error) ? 'errors.wrongCredentials' : 'errors.failed')
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
    <div className="grid w-full max-w-6xl items-center gap-10 lg:grid-cols-2 lg:gap-16">
      <div className="mx-auto flex w-full max-w-md flex-col gap-4">
        <Card>
          <CardHeader>
            <h1 id={`${id}-title`} className="font-heading text-lg leading-snug font-semibold">
              {t('title')}
            </h1>
            <CardDescription>{t('description')}</CardDescription>
          </CardHeader>
          <CardContent>
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
              <PasswordField
                id={`${id}-password`}
                autoComplete="current-password"
                error={passwordError}
                label={t('password')}
                name="password"
                ref={passwordRef}
                value={values.password}
                onChange={(value) => change('password', value)}
              />
              <div role="alert" className="text-sm text-red-800 empty:hidden dark:text-red-300">
                {credentialsError}
              </div>
              <Button disabled={pending} size="lg" type="submit" className="w-full">
                {isEntering(credentialsSignIn) ? t('submitting') : t('submit')}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card className="bg-primary/5 ring-primary/40">
          <CardHeader>
            <h2 className="font-heading text-lg leading-snug font-semibold">
              {t('showcaseTitle')}
            </h2>
            <CardDescription id={`${id}-showcase`} className="text-foreground">
              {t('showcaseDescription')}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div role="alert" className="text-sm text-red-800 empty:hidden dark:text-red-300">
              {showcaseSignIn.isError ? t('errors.showcaseFailed') : null}
            </div>
            <Button
              disabled={pending}
              size="lg"
              type="button"
              variant="outline"
              aria-describedby={`${id}-showcase`}
              className="w-full"
              onClick={() => {
                setSubmitted(false)
                credentialsSignIn.reset()
                showcaseSignIn.mutate(undefined)
              }}>
              <HugeiconsIcon icon={PlayIcon} strokeWidth={2} data-icon="inline-start" />
              {isEntering(showcaseSignIn) ? t('showcasePending') : t('showcase')}
            </Button>
          </CardContent>
        </Card>

        <p className="text-muted-foreground text-center text-sm">{t('noAccount')}</p>
      </div>

      <section
        aria-labelledby={`${id}-value`}
        className="mx-auto flex w-full max-w-md flex-col gap-8 lg:order-first lg:max-w-none">
        <h2
          id={`${id}-value`}
          className="text-2xl leading-tight font-semibold tracking-tight sm:text-3xl lg:text-4xl">
          {t('valueStatement')}
        </h2>
        <ul className="flex flex-col gap-5">
          {points.map((point) => (
            <li key={point.key} className="flex gap-3">
              <span className="bg-primary/10 text-primary flex size-9 shrink-0 items-center justify-center rounded-lg">
                <HugeiconsIcon icon={point.icon} strokeWidth={2} className="size-5" />
              </span>
              <div>
                <p className="font-medium">{t(`points.${point.key}.title`)}</p>
                <p className="text-muted-foreground text-sm">{t(`points.${point.key}.text`)}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
