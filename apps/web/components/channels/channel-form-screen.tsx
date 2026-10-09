'use client'

import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { useState } from 'react'

import { ChannelForm } from '@/components/channels/channel-form'
import { WebhookTokenReveal } from '@/components/channels/webhook-token'
import { CopyableValue } from '@/components/copy-button'
import { BackLink, LoadFailure } from '@/components/detail-parts'
import { ApiError } from '@/lib/api/client'
import { channelQuery } from '@/lib/api/queries'
import { buttonVariants } from '@edi-bridge/ui/components/button'
import { Skeleton } from '@edi-bridge/ui/components/skeleton'

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
  const t = useTranslations()
  const { data, error, isPending, refetch } = useQuery(channelQuery(id))

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-6 p-6">
      <BackLink
        href={data ? `/channels/${id}` : '/channels'}
        label={data ? t('ChannelForm.backTo', { name: data.name }) : t('Channel.back')}
      />
      {isPending ? (
        <div aria-busy className="flex max-w-2xl flex-col gap-6">
          <p role="status" className="sr-only">
            {t('Channel.loading')}
          </p>
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-72 w-full" />
        </div>
      ) : data ? (
        <>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t('ChannelForm.editTitle', { name: data.name })}
          </h1>
          <ChannelForm channel={data} />
        </>
      ) : (
        <LoadFailure
          namespace="Channel"
          notFound={error instanceof ApiError && error.status === 404}
          onRetry={() => void refetch()}
        />
      )}
    </div>
  )
}
