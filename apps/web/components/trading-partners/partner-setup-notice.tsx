'use client'

import { CheckmarkCircle02Icon, SparklesIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { type QueryClient, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { type ReactNode, useEffect, useId, useRef, useState } from 'react'

import { WebhookTokenReveal } from '@/components/channels/webhook-token'
import { CopyableValue } from '@/components/copy-button'
import { aiDraftStartHref } from '@/components/mappings/ai-draft-run'
import { nothingLeft, type SetupSummary } from '@/components/trading-partners/partner-wizard-finish'
import { Button, buttonVariants } from '@edi-bridge/ui/components/button'

function setupSummaryKey(tradingPartnerId: string) {
  return ['partner-wizard', 'setup-summary', tradingPartnerId] as const
}

export function storeSetupSummary(
  queryClient: QueryClient,
  tradingPartnerId: string,
  summary: SetupSummary,
) {
  queryClient.setQueryData(setupSummaryKey(tradingPartnerId), summary)
}

export function useSetupSummary(tradingPartnerId: string) {
  const queryClient = useQueryClient()

  const [summary, setSummary] = useState(
    () => queryClient.getQueryData<SetupSummary>(setupSummaryKey(tradingPartnerId)) ?? null,
  )

  useEffect(() => {
    queryClient.removeQueries({ queryKey: setupSummaryKey(tradingPartnerId), exact: true })
  }, [queryClient, tradingPartnerId])

  return [summary, () => setSummary(null)] as const
}

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
  const title = useRef<HTMLHeadingElement>(null)
  const { name, webhook, mappingDrafts, left } = summary

  useEffect(() => {
    title.current?.focus()
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
          <h2 id={titleId} ref={title} tabIndex={-1} className="font-semibold outline-none">
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
              <li key={connection.direction}>{t('left.connection', { name: connection.name })}</li>
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
              <li key={messageType}>
                <Link
                  href={aiDraftStartHref(mapping.id)}
                  className={buttonVariants({ variant: 'outline' })}>
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
