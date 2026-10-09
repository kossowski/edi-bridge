'use client'

import { Alert02Icon, RefreshIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { type ReactNode, useEffect, useRef, useState } from 'react'

import { MaskedSecretText } from '@/components/channels/channel-parts'
import { CopyableValue } from '@/components/copy-button'
import { Fact } from '@/components/detail-parts'
import { regenerateWebhookToken } from '@/lib/api/client'
import { storeSavedChannel } from '@/lib/api/queries'
import { webhookAuthorization, webhookTokenHeader } from '@edi-bridge/contracts'
import { Button } from '@edi-bridge/ui/components/button'

import type { Channel } from '@edi-bridge/contracts'

type WebhookChannel = Extract<Channel, { type: 'webhook' }>

export function WebhookTokenReveal({ token, children }: { token: string; children?: ReactNode }) {
  const t = useTranslations('Channel.tokenReveal')
  const heading = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    heading.current?.focus()
  }, [token])

  return (
    <section
      aria-labelledby="webhook-token-reveal"
      className="flex min-w-0 flex-col gap-4 rounded-lg border border-amber-600/40 bg-amber-500/10 p-4">
      <div className="flex items-start gap-2">
        <HugeiconsIcon
          icon={Alert02Icon}
          strokeWidth={2}
          aria-hidden
          className="mt-0.5 size-5 shrink-0 text-amber-800 dark:text-amber-300"
        />
        <div className="flex flex-col gap-1">
          <h2
            id="webhook-token-reveal"
            ref={heading}
            tabIndex={-1}
            className="font-semibold outline-none">
            {t('title')}
          </h2>
          <p className="text-sm">{t('description')}</p>
        </div>
      </div>
      <dl className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <dt className="text-sm font-medium">{t('token')}</dt>
          <dd>
            <CopyableValue label={t('token')} value={token} />
          </dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className="text-sm font-medium">{t('header')}</dt>
          <dd>
            <CopyableValue
              label={t('header')}
              value={`${webhookTokenHeader}: ${webhookAuthorization(token)}`}
            />
          </dd>
        </div>
      </dl>
      {children}
    </section>
  )
}

function RegenerateToken({
  channel,
  onRegenerated,
}: {
  channel: WebhookChannel
  onRegenerated: (token: string) => void
}) {
  const t = useTranslations('Channel.webhook.regenerate')
  const queryClient = useQueryClient()
  const [confirming, setConfirming] = useState(false)
  const toggled = useRef(false)
  const button = useRef<HTMLButtonElement>(null)
  const confirmation = useRef<HTMLParagraphElement>(null)

  useEffect(() => {
    if (toggled.current) {
      ;(confirming ? confirmation : button).current?.focus()
    }
  }, [confirming])

  function toggle(next: boolean) {
    toggled.current = true
    setConfirming(next)
  }

  const regenerate = useMutation({
    mutationFn: () => regenerateWebhookToken(channel.id),
    onSuccess: ({ channel: updated, webhookToken }) => {
      storeSavedChannel(queryClient, updated)
      toggled.current = false
      setConfirming(false)
      onRegenerated(webhookToken)
    },
  })

  if (!confirming) {
    return (
      <Button ref={button} variant="outline" className="w-fit" onClick={() => toggle(true)}>
        <HugeiconsIcon icon={RefreshIcon} strokeWidth={2} aria-hidden />
        {t('button')}
      </Button>
    )
  }

  return (
    <div
      role="group"
      aria-labelledby="regenerate-confirm"
      className="flex flex-col gap-3 rounded-lg border border-amber-600/40 bg-amber-500/10 p-3">
      <p id="regenerate-confirm" ref={confirmation} tabIndex={-1} className="text-sm outline-none">
        {t('confirmation')}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button disabled={regenerate.isPending} onClick={() => regenerate.mutate()}>
          {regenerate.isPending ? t('pending') : t('confirm')}
        </Button>
        <Button disabled={regenerate.isPending} variant="outline" onClick={() => toggle(false)}>
          {t('cancel')}
        </Button>
      </div>
      {regenerate.isError && (
        <p role="alert" className="text-sm text-red-800 dark:text-red-300">
          {t('failed')}
        </p>
      )}
    </div>
  )
}

export function WebhookAccess({ channel }: { channel: WebhookChannel }) {
  const t = useTranslations('Channel.webhook')
  const [revealed, setRevealed] = useState<string | null>(null)

  return (
    <div className="flex min-w-0 flex-col gap-4 rounded-lg border p-4">
      <p className="text-sm">
        {t.rich('description', {
          header: () => <code className="font-mono">{webhookTokenHeader}</code>,
        })}
      </p>
      <dl className="flex flex-col gap-4">
        <Fact label={t('url')}>
          <CopyableValue label={t('url')} value={channel.url} />
        </Fact>
        <Fact label={t('header')}>
          <code className="font-mono text-sm break-all">
            {webhookTokenHeader}: {webhookAuthorization('whk_…')}
          </code>
        </Fact>
        <Fact label={t('token')}>
          <MaskedSecretText secret={channel.token} />
        </Fact>
      </dl>
      {revealed && (
        <WebhookTokenReveal token={revealed}>
          <Button variant="outline" className="w-fit" onClick={() => setRevealed(null)}>
            {t('hideToken')}
          </Button>
        </WebhookTokenReveal>
      )}
      <RegenerateToken channel={channel} onRegenerated={setRevealed} />
    </div>
  )
}
