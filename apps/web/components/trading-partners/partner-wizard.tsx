'use client'

import { Tick02Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { type FormEvent, useId, useRef, useState } from 'react'
import { flushSync } from 'react-dom'

import { AppPage } from '@/components/app-page'
import { GlnField, TextField, useGlnErrorMessage } from '@/components/form-field'
import {
  initialWizardState,
  type PartnerWizardState,
  stepErrors,
  toggleDocument,
  type WizardErrors,
  type WizardField,
  wizardDocuments,
  wizardFields,
  type WizardStep,
  wizardSteps,
} from '@/components/trading-partners/partner-wizard-state'
import { tradingPartnerInputSchema } from '@edi-bridge/contracts'
import { Button, buttonVariants } from '@edi-bridge/ui/components/button'
import { Checkbox } from '@edi-bridge/ui/components/checkbox'
import { cn } from '@edi-bridge/ui/lib/utils'

function useErrorMessages() {
  const t = useTranslations('PartnerWizard.errors')
  const glnErrorMessage = useGlnErrorMessage()

  return (errors: WizardErrors) => ({
    name:
      errors.name &&
      (errors.name === 'tooLong'
        ? t('name.tooLong', { max: tradingPartnerInputSchema.shape.name.maxLength ?? 0 })
        : t('name.required')),
    gln: errors.gln && (errors.gln === 'required' ? t('glnRequired') : glnErrorMessage(errors.gln)),
    documents: errors.documents && t('documents'),
  })
}

export function PartnerWizard({ onFinish }: { onFinish: (state: PartnerWizardState) => void }) {
  const t = useTranslations('PartnerWizard')
  const errorMessages = useErrorMessages()
  const baseId = useId()
  const headingRef = useRef<HTMLHeadingElement>(null)
  const documentsRef = useRef<HTMLDivElement>(null)
  const [state, setState] = useState(initialWizardState)
  const [step, setStep] = useState<WizardStep>('partner')
  const [attempted, setAttempted] = useState(false)

  const index = wizardSteps.indexOf(step)
  const errors = attempted ? stepErrors(step, state) : {}

  const ids = {
    heading: `${baseId}-heading`,
    name: `${baseId}-name`,
    gln: `${baseId}-gln`,
    glnLater: `${baseId}-gln-later`,
    documents: `${baseId}-documents`,
  }

  function updatePartner(changes: Partial<PartnerWizardState['partner']>) {
    setState((current) => ({ ...current, partner: { ...current.partner, ...changes } }))
  }

  function focusField(field: WizardField) {
    const target =
      field === 'documents'
        ? documentsRef.current?.querySelector<HTMLElement>('[role="checkbox"]')
        : document.getElementById(ids[field])

    target?.focus()
  }

  function goTo(next: WizardStep) {
    flushSync(() => {
      setStep(next)
      setAttempted(false)
    })
    headingRef.current?.focus()
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const found = stepErrors(step, state)
    const first = wizardFields.find((field) => found[field] !== undefined)

    if (first) {
      flushSync(() => setAttempted(true))
      focusField(first)

      return
    }

    const next = wizardSteps[index + 1]

    if (next) {
      goTo(next)
    } else {
      onFinish(state)
    }
  }

  const previous = wizardSteps[index - 1]
  const messages = errorMessages(errors)
  const nameError = messages.name ?? null
  const glnError = messages.gln ?? null
  const documentsError = messages.documents ?? null

  return (
    <AppPage title={t('title')}>
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
        <ol aria-label={t('progress')} className="flex items-center gap-2">
          {wizardSteps.map((item, itemIndex) => (
            <li
              key={item}
              aria-current={item === step ? 'step' : undefined}
              className={cn(
                'flex items-center gap-2',
                itemIndex < wizardSteps.length - 1 && 'flex-1',
              )}>
              <span
                aria-hidden="true"
                className={cn(
                  'flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-medium',
                  itemIndex < index && 'bg-primary text-primary-foreground',
                  itemIndex === index && 'text-primary ring-primary ring-2',
                  itemIndex > index && 'bg-muted text-muted-foreground',
                )}>
                {itemIndex < index ? (
                  <HugeiconsIcon icon={Tick02Icon} strokeWidth={2} className="size-3.5" />
                ) : (
                  itemIndex + 1
                )}
              </span>
              <span
                className={cn(
                  'sr-only text-xs sm:not-sr-only',
                  itemIndex === index ? 'font-medium' : 'text-muted-foreground',
                )}>
                {t(`steps.${item}.label`)}
                {itemIndex < index && <span className="sr-only">, {t('stepDone')}</span>}
              </span>
              {itemIndex < wizardSteps.length - 1 && (
                <span aria-hidden="true" className="bg-border h-px min-w-2 flex-1" />
              )}
            </li>
          ))}
        </ol>

        <form noValidate className="flex flex-col gap-6" onSubmit={submit}>
          <div className="flex flex-col gap-1">
            <p className="text-muted-foreground text-sm">
              {t('stepOf', { current: index + 1, total: wizardSteps.length })}
            </p>
            <h2
              id={ids.heading}
              ref={headingRef}
              tabIndex={-1}
              className="text-lg font-semibold outline-none">
              {t(`steps.${step}.title`)}
            </h2>
            <p className="text-muted-foreground text-sm">{t(`steps.${step}.description`)}</p>
          </div>

          {step === 'partner' && (
            <div className="flex flex-col gap-6">
              <TextField
                id={ids.name}
                autoComplete="organization"
                description={t('fields.name.description')}
                error={nameError}
                label={t('fields.name.label')}
                name="name"
                value={state.partner.name}
                onChange={(name) => updatePartner({ name })}
              />
              <div className="flex flex-col gap-3">
                <GlnField
                  id={ids.gln}
                  description={t('fields.gln.description')}
                  disabled={state.partner.glnLater}
                  error={glnError}
                  label={t('fields.gln.label')}
                  value={state.partner.gln}
                  onChange={(gln) => updatePartner({ gln })}
                />
                <div className="flex flex-col gap-1">
                  <label className="flex w-fit items-center gap-2 text-sm">
                    <Checkbox
                      checked={state.partner.glnLater}
                      aria-describedby={`${ids.glnLater}-description`}
                      onCheckedChange={(glnLater) => updatePartner({ glnLater })}
                    />
                    {t('fields.glnLater.label')}
                  </label>
                  <p
                    id={`${ids.glnLater}-description`}
                    className="text-muted-foreground pl-6 text-sm">
                    {t('fields.glnLater.description')}
                  </p>
                </div>
              </div>
            </div>
          )}

          {step === 'documents' && (
            <div
              ref={documentsRef}
              role="group"
              aria-describedby={documentsError ? `${ids.documents}-error` : undefined}
              aria-labelledby={ids.heading}
              className="flex flex-col gap-2">
              {wizardDocuments.map((messageType) => (
                <label
                  key={messageType}
                  className="has-data-checked:border-primary has-data-checked:bg-muted/50 grid cursor-pointer grid-cols-[auto_1fr] items-start gap-x-3 gap-y-0.5 rounded-lg border p-3">
                  <Checkbox
                    checked={state.documents.includes(messageType)}
                    aria-describedby={`${ids.documents}-${messageType}`}
                    aria-invalid={documentsError !== null || undefined}
                    className="mt-0.5"
                    onCheckedChange={(checked) =>
                      setState((current) => ({
                        ...current,
                        documents: toggleDocument(current.documents, messageType, checked),
                      }))
                    }
                  />
                  <span className="text-sm font-medium">{t(`documents.${messageType}.title`)}</span>
                  <span
                    id={`${ids.documents}-${messageType}`}
                    className="text-muted-foreground col-start-2 text-sm">
                    {t(`documents.${messageType}.benefit`)}
                  </span>
                </label>
              ))}
              {documentsError && (
                <p id={`${ids.documents}-error`} className="text-sm text-red-800 dark:text-red-300">
                  {documentsError}
                </p>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-4">
            {previous ? (
              <Button type="button" variant="outline" onClick={() => goTo(previous)}>
                {t('back')}
              </Button>
            ) : (
              <Link href="/trading-partners" className={buttonVariants({ variant: 'ghost' })}>
                {t('cancel')}
              </Link>
            )}
            <Button type="submit">
              {index < wizardSteps.length - 1 ? t('continue') : t('finish')}
            </Button>
          </div>
        </form>
      </div>
    </AppPage>
  )
}
