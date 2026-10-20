'use client'

import { CheckmarkCircle02Icon, SparklesIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { type ReactNode, useEffect, useId, useRef } from 'react'

import { WebhookTokenReveal } from '@/components/channels/webhook-token'
import { CopyableValue } from '@/components/copy-button'
import { aiDraftStartHref } from '@/components/mappings/ai-draft-run'
import { type SkippedMappingDrafts } from '@/components/trading-partners/partner-setup-plan'
import {
  nothingForLater,
  nothingLeft,
  type SetupSummary,
} from '@/components/trading-partners/partner-wizard-finish'
import { newMappingHref } from '@/lib/navigation'
import { Button, buttonVariants } from '@edi-bridge/ui/components/button'
import { cn } from '@edi-bridge/ui/lib/utils'

function NoticeSection({ title, children }: { title: string; children: ReactNode }) {
  const id = useId()

  return (
    <section aria-labelledby={id} className="flex min-w-0 flex-col gap-2 border-t pt-4">
      <h3 id={id} className="text-sm font-medium">
        {title}
      </h3>
      {children}
    </section>
  )
}

function MappingsToCreate({ skipped }: { skipped: SkippedMappingDrafts | null }) {
  const t = useTranslations('TradingPartner.created.skipped')
  const tWizard = useTranslations('PartnerWizard')

  if (skipped === null) {
    return null
  }

  return (
    <NoticeSection title={t('title')}>
      <p className="text-sm">{t(skipped.reason)}</p>
      <ul className="flex flex-wrap gap-2">
        {skipped.messageTypes.map((messageType) => (
          <li key={messageType} className="max-w-full min-w-0">
            <Link
              href={newMappingHref(messageType)}
              className={cn(
                buttonVariants({ variant: 'outline' }),
                'h-auto min-h-8 max-w-full py-1.5 text-left whitespace-normal',
              )}>
              {t('create', { documents: tWizard(`documentNames.${messageType}`) })}
            </Link>
          </li>
        ))}
      </ul>
    </NoticeSection>
  )
}

export function SetupNotice({
  summary,
  onDismiss,
}: {
  summary: SetupSummary
  onDismiss: () => void
}) {
  const t = useTranslations('TradingPartner.created')
  const tWebhook = useTranslations('TradingPartner.addConnection.webhook')
  const tWizard = useTranslations('PartnerWizard')
  const titleId = useId()
  const titleRef = useRef<HTMLHeadingElement>(null)
  const { name, webhook, mappingDrafts, skippedMappingDrafts, left, later } = summary

  useEffect(() => {
    titleRef.current?.focus()
  }, [])

  return (
    <section
      aria-labelledby={titleId}
      className="flex max-w-2xl min-w-0 flex-col gap-4 rounded-lg border p-4">
      <div className="flex items-start gap-2">
        <HugeiconsIcon
          icon={CheckmarkCircle02Icon}
          strokeWidth={2}
          aria-hidden
          className="text-success-text mt-0.5 size-5 shrink-0"
        />
        <div className="flex flex-col gap-1">
          <h2 id={titleId} ref={titleRef} tabIndex={-1} className="font-semibold outline-none">
            {t('title', { name })}
          </h2>
          <p className="text-muted-foreground text-sm">{t('description', { name })}</p>
        </div>
      </div>

      {!nothingLeft(left) && (
        <NoticeSection title={t('left.title')}>
          <p className="text-destructive-text text-sm">{t('left.description')}</p>
          <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
            {left.connections.map((connection) => (
              <li key={connection.direction}>
                {t(connection.reason === 'invalid' ? 'left.connectionInvalid' : 'left.connection', {
                  name: connection.name,
                })}
              </li>
            ))}
            {left.mappingDrafts.map((messageType) => (
              <li key={messageType}>
                {t('left.mappingDraft', { documents: tWizard(`documentNames.${messageType}`) })}
              </li>
            ))}
            {left.routes.map((route) => (
              <li key={route.messageType}>{t('left.route', { name: route.name })}</li>
            ))}
          </ul>
        </NoticeSection>
      )}

      <MappingsToCreate skipped={skippedMappingDrafts} />

      {!nothingForLater(later) && (
        <NoticeSection title={t('later.title')}>
          <p className="text-sm">{t('later.description')}</p>
          <ul className="flex list-disc flex-col gap-2 pl-5 text-sm">
            {later.connections.map((direction) => (
              <li key={direction}>
                <span className="font-medium">{t(`later.connection.${direction}`, { name })}</span>{' '}
                <span className="text-muted-foreground">{t('later.connectionNext', { name })}</span>
              </li>
            ))}
            {later.documents.map(({ messageType, reasons }) => {
              const documents = tWizard(`documentNames.${messageType}`)

              return (
                <li key={messageType}>
                  <span className="font-medium">{t('later.route', { documents })}</span>{' '}
                  <span className="text-muted-foreground">
                    {reasons
                      .map((reason) => t(`later.reasons.${reason}`, { name, documents }))
                      .join(' ')}
                  </span>
                </li>
              )
            })}
          </ul>
        </NoticeSection>
      )}

      {webhook && (
        <NoticeSection title={t('webhook.title', { name })}>
          <p className="text-sm">{t('webhook.description', { name })}</p>
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">{tWebhook('url')}</span>
            <CopyableValue label={tWebhook('url')} value={webhook.channel.url} />
          </div>
          <WebhookTokenReveal token={webhook.token} />
        </NoticeSection>
      )}

      {mappingDrafts.length > 0 && (
        <NoticeSection title={t('drafts.title')}>
          <p className="text-sm">{t('drafts.description')}</p>
          <ul className="flex flex-wrap gap-2">
            {mappingDrafts.map(({ messageType, mapping }) => (
              <li key={messageType} className="max-w-full min-w-0">
                <Link
                  href={aiDraftStartHref(mapping.id)}
                  className={cn(
                    buttonVariants({ variant: 'outline' }),
                    'h-auto min-h-8 max-w-full py-1.5 text-left whitespace-normal',
                  )}>
                  <HugeiconsIcon
                    icon={SparklesIcon}
                    strokeWidth={2}
                    aria-hidden
                    data-icon="inline-start"
                  />
                  {t('drafts.open', { documents: tWizard(`documentNames.${messageType}`) })}
                </Link>
              </li>
            ))}
          </ul>
        </NoticeSection>
      )}

      <Button className="w-fit" onClick={onDismiss}>
        {t('dismiss')}
      </Button>
    </section>
  )
}
