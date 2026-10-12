'use client'

import {
  ArrowRight01Icon,
  CheckmarkCircle02Icon,
  CircleIcon,
  ComputerIcon,
  Rocket01Icon,
  Store01Icon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import Link from 'next/link'

import { AppPage } from '@/components/app-page'
import { LoadError } from '@/components/load-error'
import { Term } from '@/components/term'
import { useCanChange } from '@/hooks/use-session'
import { firstStepsQuery } from '@/lib/api/queries'
import { firstStepHref } from '@/lib/first-step-href'
import {
  type FirstStep,
  type FirstStepId,
  firstStepIds,
  type FirstSteps,
  firstStepsProgress,
} from '@edi-bridge/contracts'
import { Badge } from '@edi-bridge/ui/components/badge'
import { buttonVariants } from '@edi-bridge/ui/components/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@edi-bridge/ui/components/card'
import { Progress, ProgressLabel, ProgressValue } from '@edi-bridge/ui/components/progress'
import { Skeleton } from '@edi-bridge/ui/components/skeleton'
import { cn } from '@edi-bridge/ui/lib/utils'

import type { GlossaryKey } from '@/lib/glossary'

const stepTerms = {
  gln: undefined,
  erpConnection: 'channel',
  tradingPartner: 'tradingPartner',
  mapping: 'mapping',
  testInterchange: 'testMode',
  production: undefined,
} as const satisfies Record<FirstStepId, GlossaryKey | undefined>

function ExplainerBox({
  icon,
  part,
  highlighted = false,
}: {
  icon: IconSvgElement
  part: 'tradingPartner' | 'bridge' | 'erp'
  highlighted?: boolean
}) {
  const t = useTranslations('FirstSteps.explainer')

  return (
    <div
      className={cn(
        'flex-1 space-y-1 rounded-lg border p-4 text-center',
        highlighted ? 'border-primary/40 bg-primary/5' : 'bg-muted/50',
      )}>
      <HugeiconsIcon
        icon={icon}
        strokeWidth={2}
        className={cn('mx-auto size-6', highlighted && 'text-primary')}
      />
      <p className="text-sm font-medium">{t(`${part}.title`)}</p>
      <p className={cn('text-xs', highlighted ? 'text-foreground' : 'text-muted-foreground')}>
        {t(`${part}.text`)}
      </p>
    </div>
  )
}

function FlowArrow() {
  return (
    <HugeiconsIcon
      icon={ArrowRight01Icon}
      strokeWidth={2}
      aria-hidden
      className="text-muted-foreground mx-auto size-5 shrink-0 rotate-90 @2xl:rotate-0"
    />
  )
}

function Explainer() {
  const t = useTranslations('FirstSteps.explainer')

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>{t('title')}</h2>
        </CardTitle>
        <CardDescription>
          {t.rich('description', {
            term: (chunks) => <Term glossaryKey="interchange">{chunks}</Term>,
          })}
        </CardDescription>
      </CardHeader>
      <CardContent className="@container">
        <div className="flex flex-col items-stretch gap-3 @2xl:flex-row @2xl:items-center">
          <ExplainerBox icon={Store01Icon} part="tradingPartner" />
          <FlowArrow />
          <ExplainerBox highlighted icon={Rocket01Icon} part="bridge" />
          <FlowArrow />
          <ExplainerBox icon={ComputerIcon} part="erp" />
        </div>
      </CardContent>
    </Card>
  )
}

function StepState({ done, next }: { done: boolean; next: boolean }) {
  const t = useTranslations('FirstSteps.steps')

  if (done) {
    return <Badge variant="secondary">{t('done')}</Badge>
  }

  if (next) {
    return <Badge>{t('next')}</Badge>
  }

  return <span className="text-muted-foreground text-xs">{t('open')}</span>
}

function StepAction({
  step,
  next,
  canChange,
}: {
  step: FirstStep
  next: boolean
  canChange: boolean
}) {
  const t = useTranslations('FirstSteps.steps')

  if (!canChange) {
    return next && <p className="text-sm">{t('viewer')}</p>
  }

  return (
    <Link
      href={firstStepHref(step.target)}
      className={buttonVariants({ size: 'sm', variant: next ? 'default' : 'outline' })}>
      {t(`${step.id}.action`)}
      <HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={2} data-icon="inline-end" />
    </Link>
  )
}

function StepItem({
  step,
  number,
  next,
  canChange,
}: {
  step: FirstStep
  number: number
  next: boolean
  canChange: boolean
}) {
  const t = useTranslations('FirstSteps.steps')
  const glossaryKey = stepTerms[step.id]

  return (
    <li
      aria-current={next ? 'step' : undefined}
      className={cn(
        'bg-card flex gap-3 rounded-xl border p-4',
        next && 'border-primary/50 ring-primary/20 ring-1',
      )}>
      <HugeiconsIcon
        icon={step.done ? CheckmarkCircle02Icon : CircleIcon}
        strokeWidth={2}
        aria-hidden
        className={cn(
          'mt-0.5 size-6 shrink-0',
          step.done ? 'text-primary' : 'text-muted-foreground',
        )}
      />
      <div className="flex min-w-0 flex-1 flex-col items-start gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className={cn('text-sm font-medium', step.done && 'text-muted-foreground')}>
            <span className="sr-only">{t('number', { number })}: </span>
            <span aria-hidden>{number}. </span>
            {t(`${step.id}.title`)}
          </h3>
          <Badge variant="outline">{t(`${step.id}.effort`)}</Badge>
          <StepState done={step.done} next={next} />
        </div>
        <p className="text-muted-foreground text-sm">
          {t.rich(`${step.id}.why`, {
            term: (chunks) =>
              glossaryKey ? <Term glossaryKey={glossaryKey}>{chunks}</Term> : chunks,
          })}
        </p>
        {!step.done && <StepAction canChange={canChange} next={next} step={step} />}
      </div>
    </li>
  )
}

function StepList({ data }: { data: FirstSteps }) {
  const t = useTranslations('FirstSteps.steps')
  const canChange = useCanChange()
  const { next } = firstStepsProgress(data)

  return (
    <ol aria-label={t('label')} className="flex flex-col gap-3">
      {data.steps.map((step, index) => (
        <StepItem
          key={step.id}
          canChange={canChange}
          next={step.id === next}
          number={index + 1}
          step={step}
        />
      ))}
    </ol>
  )
}

function LoadingSteps() {
  return (
    <div aria-hidden className="flex flex-col gap-3">
      {firstStepIds.map((id) => (
        <div key={id} className="bg-card flex gap-3 rounded-xl border p-4">
          <Skeleton className="size-6 rounded-full" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-4 w-56 max-w-full" />
            <Skeleton className="h-4 w-full" />
          </div>
        </div>
      ))}
    </div>
  )
}

function Heading({ data }: { data: FirstSteps | undefined }) {
  const t = useTranslations('FirstSteps')
  const progress = data && firstStepsProgress(data)
  const total = firstStepIds.length

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
        {t('heading', { total })}
      </h2>
      {progress ? (
        <Progress value={(progress.done / progress.total) * 100} className="max-w-md">
          <ProgressLabel>
            {t('progress', { done: progress.done, total: progress.total })}
          </ProgressLabel>
          <ProgressValue />
        </Progress>
      ) : (
        <Skeleton aria-hidden className="h-9 w-full max-w-md" />
      )}
    </section>
  )
}

export function FirstStepsScreen() {
  const t = useTranslations()
  const { data, isError, isPending, refetch } = useQuery(firstStepsQuery)

  return (
    <AppPage busy={isPending && !isError} title={t('Pages.firstSteps.label')}>
      <p aria-live="polite" className="sr-only">
        {isPending && !isError ? t('FirstSteps.loading') : ''}
      </p>
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-8">
        {isError ? (
          <LoadError
            description={t('FirstSteps.error.description')}
            retryLabel={t('FirstSteps.error.retry')}
            title={t('FirstSteps.error.title')}
            onRetry={() => void refetch()}
          />
        ) : (
          <>
            <Heading data={data} />
            <Explainer />
            {data ? <StepList data={data} /> : <LoadingSteps />}
          </>
        )}
      </div>
    </AppPage>
  )
}
