'use client'

import { Tick02Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { type FormEvent, useId, useRef, useState } from 'react'
import { flushSync } from 'react-dom'

import { AppPage } from '@/components/app-page'
import { GlnField, TextField, useGlnErrorMessage } from '@/components/form-field'
import { CheckboxCards } from '@/components/trading-partners/choice-cards'
import { type PlanChannel, type SetupPlan } from '@/components/trading-partners/partner-setup-plan'
import { ConnectionsStep } from '@/components/trading-partners/partner-wizard-connections'
import { finishSetup, setupSummary } from '@/components/trading-partners/partner-wizard-finish'
import {
  MappingsStep,
  useOfferedMappings,
} from '@/components/trading-partners/partner-wizard-mappings'
import { ReviewStep, useSetupPlan } from '@/components/trading-partners/partner-wizard-review'
import {
  firstInvalidField,
  initialWizardState,
  type PartnerField,
  type PartnerWizardState,
  stepErrors,
  toggleDocument,
  type WizardErrors,
  type WizardField,
  wizardDocuments,
  wizardFieldId,
  wizardResult,
  type WizardStep,
  wizardSteps,
  withTakenGln,
} from '@/components/trading-partners/partner-wizard-state'
import { useTakenGln } from '@/hooks/use-taken-gln'
import {
  createChannel,
  createFlow,
  createMapping,
  createTradingPartner,
  isConflict,
} from '@/lib/api/client'
import { storeFinishedSetup, storeSetupSummary } from '@/lib/api/queries'
import { tradingPartnerInputSchema } from '@edi-bridge/contracts'
import { Button, buttonVariants } from '@edi-bridge/ui/components/button'
import { Checkbox } from '@edi-bridge/ui/components/checkbox'
import { cn } from '@edi-bridge/ui/lib/utils'

const focusable = 'input:not([type="hidden"]), [role="checkbox"], [role="radio"], button, textarea'

function useErrorMessage() {
  const t = useTranslations('PartnerWizard.errors')
  const glnErrorMessage = useGlnErrorMessage()

  return (errors: WizardErrors, field: PartnerField): string | null => {
    switch (field) {
      case 'name':
        if (errors.name === undefined) {
          return null
        }

        return errors.name === 'tooLong'
          ? t('name.tooLong', { max: tradingPartnerInputSchema.shape.name.maxLength ?? 0 })
          : t('name.required')
      case 'gln':
        if (errors.gln === undefined) {
          return null
        }

        if (errors.gln === 'required' || errors.gln === 'taken') {
          return t(`gln.${errors.gln}`)
        }

        return glnErrorMessage(errors.gln)
      case 'documents':
        return errors.documents === undefined ? null : t('documents.required')
    }
  }
}

const finishApi = { createTradingPartner, createChannel, createMapping, createFlow }

export function PartnerWizard() {
  const t = useTranslations('PartnerWizard')
  const errorMessage = useErrorMessage()
  const baseId = useId()
  const headingRef = useRef<HTMLHeadingElement>(null)
  const [state, setState] = useState(initialWizardState)
  const [step, setStep] = useState<WizardStep>('partner')
  const [attempted, setAttempted] = useState(false)
  const takenGln = useTakenGln()
  const queryClient = useQueryClient()
  const router = useRouter()

  const offeredMappings = useOfferedMappings(state.documents, step === 'mappings')
  const result = wizardResult(state)
  const planState = useSetupPlan(result, step === 'review')

  const finish = useMutation({
    mutationFn: (plan: SetupPlan<PlanChannel>) => finishSetup(plan, finishApi),
    onSuccess: (finished, plan) => {
      storeFinishedSetup(queryClient, finished)
      storeSetupSummary(queryClient, finished.tradingPartner.id, setupSummary(plan, finished))
      router.push(`/trading-partners/${finished.tradingPartner.id}`)
    },
    onError: (error, plan) => {
      if (takenGln.remember(error, plan.partner.gln)) {
        flushSync(() => {
          setStep('partner')
          setAttempted(true)
        })
        focusField('gln')
      }
    },
  })

  const finishing = finish.isPending || finish.isSuccess
  const index = wizardSteps.indexOf(step)

  function currentErrors() {
    return withTakenGln(stepErrors(step, state, offeredMappings), state, takenGln.takenGln)
  }

  const errors = attempted ? currentErrors() : {}

  const glnLaterId = `${baseId}-gln-later`

  function fieldId(field: WizardField) {
    return wizardFieldId(baseId, field)
  }

  function updatePartner(changes: Partial<PartnerWizardState['partner']>) {
    setState((current) => ({ ...current, partner: { ...current.partner, ...changes } }))
  }

  function focusField(field: WizardField) {
    const element = document.getElementById(fieldId(field))

    const target = element?.matches(focusable)
      ? element
      : element?.querySelector<HTMLElement>(focusable)

    target?.focus()
  }

  function goTo(next: WizardStep) {
    finish.reset()
    flushSync(() => {
      setStep(next)
      setAttempted(false)
    })
    headingRef.current?.focus()
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (finishing) {
      return
    }

    const found = currentErrors()
    const first = firstInvalidField(found)

    if (first) {
      flushSync(() => setAttempted(true))
      focusField(first)

      return
    }

    const next = wizardSteps[index + 1]

    if (next) {
      goTo(next)
    } else if (planState.status === 'ready') {
      finish.mutate(planState.plan)
    }
  }

  function submitLabel() {
    if (index < wizardSteps.length - 1) {
      return t('continue')
    }

    return finishing ? t('finishing') : t('finish')
  }

  const previous = wizardSteps[index - 1]

  return (
    <AppPage title={t('title')}>
      <div className="@container mx-auto flex w-full max-w-2xl flex-col gap-6">
        <ol aria-label={t('progress')} className="flex items-center gap-2">
          {wizardSteps.map((item, itemIndex) => (
            <li
              key={item}
              aria-current={item === step ? 'step' : undefined}
              className={cn(
                'flex min-w-0 items-center gap-2',
                itemIndex < wizardSteps.length - 1 && 'flex-auto',
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
                  'sr-only text-xs @xl:not-sr-only @xl:truncate',
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
            <h2 ref={headingRef} tabIndex={-1} className="text-lg font-semibold outline-none">
              {t(`steps.${step}.title`)}
            </h2>
            <p className="text-muted-foreground text-sm">{t(`steps.${step}.description`)}</p>
          </div>

          {step === 'partner' && (
            <div className="flex flex-col gap-6">
              <TextField
                id={fieldId('name')}
                autoComplete="organization"
                description={t('fields.name.description')}
                error={errorMessage(errors, 'name')}
                label={t('fields.name.label')}
                name="name"
                value={state.partner.name}
                onChange={(name) => updatePartner({ name })}
              />
              <div className="flex flex-col gap-3">
                <GlnField
                  id={fieldId('gln')}
                  description={t('fields.gln.description')}
                  disabled={state.partner.glnLater}
                  error={errorMessage(errors, 'gln')}
                  label={t('fields.gln.label')}
                  value={state.partner.gln}
                  onChange={(gln) => updatePartner({ gln })}
                />
                <div className="flex flex-col gap-1">
                  <label className="flex w-fit items-center gap-2 text-sm">
                    <Checkbox
                      checked={state.partner.glnLater}
                      aria-describedby={`${glnLaterId}-description`}
                      onCheckedChange={(glnLater) => updatePartner({ glnLater })}
                    />
                    {t('fields.glnLater.label')}
                  </label>
                  <p
                    id={`${glnLaterId}-description`}
                    className="text-muted-foreground pl-6 text-sm">
                    {t('fields.glnLater.description')}
                  </p>
                </div>
              </div>
            </div>
          )}

          {step === 'documents' && (
            <CheckboxCards
              id={fieldId('documents')}
              error={errorMessage(errors, 'documents')}
              hideLabel
              items={wizardDocuments.map((messageType) => ({
                value: messageType,
                title: t(`documents.${messageType}.title`),
                description: t(`documents.${messageType}.benefit`),
              }))}
              label={t('steps.documents.title')}
              value={state.documents}
              onChange={(messageType, checked) =>
                setState((current) => ({
                  ...current,
                  documents: toggleDocument(current.documents, messageType, checked),
                }))
              }
            />
          )}

          {step === 'connections' && (
            <ConnectionsStep
              errors={errors}
              idPrefix={baseId}
              state={state}
              onUpdate={(direction, update) =>
                setState((current) => ({
                  ...current,
                  connections: {
                    ...current.connections,
                    [direction]: update(current.connections[direction]),
                  },
                }))
              }
            />
          )}

          {step === 'mappings' && (
            <MappingsStep
              documents={state.documents}
              errors={errors}
              idPrefix={baseId}
              mappings={state.mappings}
              onUpdate={(document, update) =>
                setState((current) => ({
                  ...current,
                  mappings: { ...current.mappings, [document]: update(current.mappings[document]) },
                }))
              }
            />
          )}

          {step === 'review' && <ReviewStep state={planState} />}

          {finish.isError && !isConflict(finish.error) && (
            <p role="alert" className="text-destructive-text text-sm">
              {t('finishFailed', { name: result.partner.name })}
            </p>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-4">
            {previous ? (
              <Button
                disabled={finishing}
                type="button"
                variant="outline"
                onClick={() => goTo(previous)}>
                {t('back')}
              </Button>
            ) : (
              <Link href="/trading-partners" className={buttonVariants({ variant: 'ghost' })}>
                {t('cancel')}
              </Link>
            )}
            <Button
              type="submit"
              aria-disabled={
                finishing || (step === 'review' && planState.status !== 'ready') || undefined
              }
              className="aria-disabled:cursor-progress aria-disabled:opacity-50">
              {submitLabel()}
            </Button>
          </div>
        </form>
      </div>
    </AppPage>
  )
}
