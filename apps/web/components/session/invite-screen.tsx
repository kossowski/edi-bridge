'use client'

import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { useId, useRef, useState } from 'react'

import { PasswordField, TextField } from '@/components/form-field'
import { useValidatedSubmit } from '@/hooks/use-validated-submit'
import { acceptInvite, acceptInviteRefusalOf, signIn } from '@/lib/api/client'
import { validateAcceptInviteForm } from '@/lib/forms/invite'
import {
  type AcceptInviteInput,
  inviteValidityDays,
  maxPasswordLength,
  maxUserNameLength,
  minPasswordLength,
} from '@edi-bridge/contracts'
import { Button, buttonVariants } from '@edi-bridge/ui/components/button'
import { Card, CardContent, CardDescription, CardHeader } from '@edi-bridge/ui/components/card'

import { isEntering, useEnterWorkspace } from './use-enter-workspace'

const limits = { min: minPasswordLength, max: maxPasswordLength, days: inviteValidityDays }

function focusOnMount(node: HTMLElement | null) {
  node?.focus()
}

function Outcome({ title, text }: { title: string; text: string }) {
  const t = useTranslations('Invite')

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <h1
          ref={focusOnMount}
          tabIndex={-1}
          className="font-heading text-lg leading-snug font-semibold outline-none">
          {title}
        </h1>
        <CardDescription>{text}</CardDescription>
      </CardHeader>
      <CardContent>
        <Link href="/login" className={buttonVariants({ size: 'lg', className: 'w-full' })}>
          {t('signIn')}
        </Link>
      </CardContent>
    </Card>
  )
}

export function InviteScreen({ token }: { token: string }) {
  const t = useTranslations('Invite')
  const id = useId()
  const nameRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)
  const [values, setValues] = useState({ name: '', password: '' })
  const [acceptedEmail, setAcceptedEmail] = useState<string | null>(null)

  const enter = useEnterWorkspace(async (input: AcceptInviteInput) => {
    const { email } = await acceptInvite(input)
    setAcceptedEmail(email)

    return signIn({ email, password: input.password })
  })

  const result = validateAcceptInviteForm({ token, ...values })
  const errors = 'error' in result ? result.error : {}

  const { submitted, submit } = useValidatedSubmit({
    result,
    mutation: enter,
    firstInvalid: errors.name ? nameRef : passwordRef,
  })

  if (enter.isError && acceptedEmail !== null) {
    return (
      <Outcome
        text={t('outcome.signInFailed.text', { email: acceptedEmail })}
        title={t('outcome.signInFailed.title')}
      />
    )
  }

  const refusal = acceptInviteRefusalOf(enter.error)

  if (refusal !== null && refusal !== 'existingAccount') {
    return (
      <Outcome text={t(`outcome.${refusal}.text`, limits)} title={t(`outcome.${refusal}.title`)} />
    )
  }

  const nameError =
    submitted && errors.name ? t(`errors.name.${errors.name}`, { max: maxUserNameLength }) : null

  const passwordError =
    submitted && errors.password ? t(`errors.password.${errors.password}`, limits) : null

  const requestError = enter.isError
    ? t(refusal === 'existingAccount' ? 'errors.existingAccount' : 'errors.failed')
    : null

  function change(field: keyof typeof values, value: string) {
    setValues((current) => ({ ...current, [field]: value }))
    enter.reset()
  }

  return (
    <Card className="w-full max-w-md">
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
            id={`${id}-name`}
            autoComplete="name"
            error={nameError}
            label={t('name')}
            name="name"
            ref={nameRef}
            value={values.name}
            onChange={(value) => change('name', value)}
          />
          <PasswordField
            id={`${id}-password`}
            autoComplete="new-password"
            description={t('passwordHint', limits)}
            error={passwordError}
            label={t('password')}
            name="password"
            ref={passwordRef}
            value={values.password}
            onChange={(value) => change('password', value)}
          />
          <div role="alert" className="text-sm text-red-800 empty:hidden dark:text-red-300">
            {requestError}
          </div>
          <Button disabled={isEntering(enter)} size="lg" type="submit" className="w-full">
            {isEntering(enter) ? t('submitting') : t('submit')}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
