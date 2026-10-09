'use client'

import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { useState } from 'react'

import { ChannelForm } from '@/components/channels/channel-form'
import { WebhookTokenReveal } from '@/components/channels/webhook-token'
import { CopyableValue } from '@/components/copy-button'
import { BackLink } from '@/components/detail-parts'
import { EditScreen } from '@/components/edit-screen'
import { channelQuery } from '@/lib/api/queries'
import { buttonVariants } from '@edi-bridge/ui/components/button'

import type { CreatedChannel } from '@edi-bridge/contracts'

function CreatedWebhook({ created }: { created: CreatedChannel }) {
  const t = useTranslations('ChannelForm.created')
  const { channel, webhookToken } = created

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <p role="status" className="text-sm">
        {t('status', { name: channel.name })}
      </p>
      {channel.type === 'webhook' && (
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">{t('url')}</span>
          <CopyableValue label={t('url')} value={channel.url} />
        </div>
      )}
      {webhookToken && (
        <WebhookTokenReveal token={webhookToken}>
          <Link href={`/channels/${channel.id}`} className={buttonVariants({ className: 'w-fit' })}>
            {t('continue')}
          </Link>
        </WebhookTokenReveal>
      )}
    </div>
  )
}

export function NewChannelScreen() {
  const t = useTranslations()
  const [created, setCreated] = useState<CreatedChannel | null>(null)

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-6 p-6">
      <BackLink href="/channels" label={t('Channel.back')} />
      <h1 className="text-2xl font-semibold tracking-tight">
        {created
          ? t('ChannelForm.created.title', { name: created.channel.name })
          : t('ChannelForm.createTitle')}
      </h1>
      {created ? <CreatedWebhook created={created} /> : <ChannelForm onCreated={setCreated} />}
    </div>
  )
}

export function EditChannelScreen({ id }: { id: string }) {
  const query = useQuery(channelQuery(id))

  return (
    <EditScreen
      detailHref={`/channels/${id}`}
      listHref="/channels"
      namespace="Channel"
      query={query}>
      {(channel) => <ChannelForm channel={channel} />}
    </EditScreen>
  )
}
