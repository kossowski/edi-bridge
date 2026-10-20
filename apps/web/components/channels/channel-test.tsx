'use client'

import { Alert02Icon, CheckmarkCircle02Icon, Loading03Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useMutation, type UseMutationResult, useQueryClient } from '@tanstack/react-query'
import { useFormatter, useNow, useTranslations } from 'next-intl'

import { acceptHostKey, testChannel } from '@/lib/api/client'
import { storeSavedChannel } from '@/lib/api/queries'
import { Button } from '@edi-bridge/ui/components/button'

import type { Channel, ChannelTestResult, TestedHostKey } from '@edi-bridge/contracts'

type AcceptMutation = UseMutationResult<Channel, Error, TestedHostKey>

function KeyValue({ label, fingerprint }: { label: string; fingerprint: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs font-medium">{label}</dt>
      <dd className="font-mono text-xs break-all">{fingerprint}</dd>
    </div>
  )
}

function TestedKey({
  channel,
  hostKey,
  accept,
}: {
  channel: Channel
  hostKey: TestedHostKey
  accept: AcceptMutation
}) {
  const t = useTranslations('Channel.test.hostKey')

  if (hostKey.state === 'matches') {
    return (
      <div className="flex flex-col gap-2">
        <p>{t('matches')}</p>
        <dl>
          <KeyValue fingerprint={hostKey.fingerprint} label={t('shown')} />
        </dl>
      </div>
    )
  }

  const confirmed = channel.type === 'sftp' ? (channel.hostKeyFingerprint ?? null) : null

  return (
    <div className="flex flex-col gap-2">
      <dl className="flex flex-col gap-2">
        <KeyValue fingerprint={hostKey.fingerprint} label={t('shown')} />
        {hostKey.state === 'mismatch' && confirmed !== null && !accept.isSuccess && (
          <KeyValue fingerprint={confirmed} label={t('confirmed')} />
        )}
      </dl>
      {hostKey.state === 'unchecked' && <p>{t('unchecked')}</p>}
      {accept.isSuccess ? (
        <p role="status">{t('accepted')}</p>
      ) : (
        <Button
          size="sm"
          variant="outline"
          aria-disabled={accept.isPending || undefined}
          className="w-fit aria-disabled:cursor-progress aria-disabled:opacity-70"
          onClick={() => {
            if (!accept.isPending) {
              accept.mutate(hostKey)
            }
          }}>
          {accept.isPending
            ? t('accepting')
            : hostKey.state === 'mismatch'
              ? t('acceptNew')
              : t('accept')}
        </Button>
      )}
      {accept.isError && (
        <p role="alert" className="text-destructive-text">
          {t('acceptFailed')}
        </p>
      )}
    </div>
  )
}

function TestOutcome({
  channel,
  result,
  accept,
}: {
  channel: Channel
  result: ChannelTestResult
  accept: AcceptMutation
}) {
  const t = useTranslations('Channel.test')
  const format = useFormatter()
  const now = useNow({ updateInterval: 30_000 })

  const tested = t.rich('testedAt', {
    time: format.relativeTime(new Date(result.testedAt), now),
    when: (chunks) => <time dateTime={result.testedAt}>{chunks}</time>,
  })

  const hostKey = result.hostKey && (
    <TestedKey accept={accept} channel={channel} hostKey={result.hostKey} />
  )

  // Once the new key is accepted, the mismatch no longer says anything wrong about the server.
  const mismatchAccepted = result.hostKey?.state === 'mismatch' && accept.isSuccess

  return result.outcome === 'succeeded' || mismatchAccepted ? (
    <div className="flex items-start gap-2 text-sm">
      <HugeiconsIcon
        icon={CheckmarkCircle02Icon}
        strokeWidth={2}
        aria-hidden
        className="text-success-text mt-0.5 size-4 shrink-0"
      />
      <div className="flex flex-col gap-1">
        <p>
          {result.outcome === 'succeeded' && `${t('succeeded')} `}
          <span className="text-muted-foreground">{tested}</span>
        </p>
        {hostKey}
      </div>
    </div>
  ) : (
    <div className="border-destructive/30 bg-destructive/5 flex items-start gap-2 rounded-lg border p-3 text-sm">
      <HugeiconsIcon
        icon={Alert02Icon}
        strokeWidth={2}
        aria-hidden
        className="text-destructive-text mt-0.5 size-4 shrink-0"
      />
      <div className="flex flex-col gap-1">
        <p className="text-destructive-text font-medium">{t(`failed.${result.reason}.title`)}</p>
        <p>{t(`failed.${result.reason}.hint`)}</p>
        <p>{tested}</p>
        {hostKey}
      </div>
    </div>
  )
}

function TestStatus({
  channel,
  test,
  accept,
}: {
  channel: Channel
  test: Pick<UseMutationResult<ChannelTestResult>, 'isPending' | 'isError' | 'data'>
  accept: AcceptMutation
}) {
  const t = useTranslations('Channel.test')

  if (test.isPending) {
    return <p className="sr-only">{t('pendingStatus', { name: channel.name })}</p>
  }

  if (test.isError) {
    return <p className="text-destructive-text text-sm">{t('requestFailed')}</p>
  }

  return test.data ? <TestOutcome accept={accept} channel={channel} result={test.data} /> : null
}

export function TestConnection({ channel }: { channel: Channel }) {
  const t = useTranslations('Channel.test')
  const queryClient = useQueryClient()

  const accept = useMutation({
    mutationFn: ({ fingerprint }: TestedHostKey) => acceptHostKey(channel.id, fingerprint),
    onSuccess: (saved) => storeSavedChannel(queryClient, saved),
  })

  const test = useMutation({
    mutationFn: () => testChannel(channel.id),
    onMutate: () => accept.reset(),
  })

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        aria-disabled={test.isPending || undefined}
        className="w-fit shrink-0 aria-disabled:cursor-progress aria-disabled:opacity-70"
        onClick={() => {
          if (!test.isPending) {
            test.mutate()
          }
        }}>
        {test.isPending && (
          <HugeiconsIcon
            icon={Loading03Icon}
            strokeWidth={2}
            aria-hidden
            className="animate-spin motion-reduce:animate-none"
            data-icon="inline-start"
          />
        )}
        {test.isPending ? t('pending') : t('button')}
        <span className="sr-only"> {channel.name}</span>
      </Button>
      <div aria-live="polite" className="basis-full empty:hidden">
        <TestStatus accept={accept} channel={channel} test={test} />
      </div>
    </>
  )
}
