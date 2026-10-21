'use client'

import { Alert02Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useFormatter, useTranslations } from 'next-intl'
import Link from 'next/link'

import type { ReactNode } from 'react'

import {
  isInboundSftp,
  pollProblemFix,
  pollProblemOf,
} from '@/components/channels/poll-problem-fix'
import { linkClass } from '@/components/detail-parts'
import { useCanChange } from '@/hooks/use-session'
import { cn } from '@edi-bridge/ui/lib/utils'

import type { Channel, PollProblem } from '@edi-bridge/contracts'

function useSince(problem: PollProblem) {
  const format = useFormatter()

  return {
    since: format.dateTime(new Date(problem.since), { dateStyle: 'medium', timeStyle: 'short' }),
    time: (chunks: ReactNode) => <time dateTime={problem.since}>{chunks}</time>,
  }
}

function FixLink({
  channelId,
  problem,
  className,
}: {
  channelId: string
  problem: PollProblem
  className?: string
}) {
  const t = useTranslations('Channel.pollProblem')
  const fix = pollProblemFix(channelId, problem.reason)

  return (
    <Link href={fix.href} className={cn(linkClass, className)}>
      {t(`fix.${fix.target}`)}
    </Link>
  )
}

type InboundSftpChannel = Extract<Channel, { type: 'sftp'; direction: 'inbound' }>

function PollProblemNotice({
  channel,
  problem,
}: {
  channel: InboundSftpChannel
  problem: PollProblem
}) {
  const t = useTranslations('Channel.pollProblem')
  const tFailed = useTranslations('Channel.test.failed')
  const canChange = useCanChange()
  const since = useSince(problem)

  return (
    <section
      aria-labelledby="channel-poll-problem"
      className="border-destructive/30 bg-destructive/5 flex items-start gap-2 rounded-lg border p-3 text-sm">
      <HugeiconsIcon
        icon={Alert02Icon}
        strokeWidth={2}
        aria-hidden
        className="text-destructive-text mt-0.5 size-4 shrink-0"
      />
      <div className="flex min-w-0 flex-col gap-1">
        <h2 id="channel-poll-problem" className="text-destructive-text font-semibold">
          {t('title')}
        </h2>
        <p className="font-medium">{tFailed(`${problem.reason}.title`)}</p>
        <p>{tFailed(`${problem.reason}.hint`)}</p>
        <p>{t.rich('since', { ...since, minutes: channel.pollingIntervalMinutes })}</p>
        {canChange ? (
          <FixLink channelId={channel.id} problem={problem} className="w-fit" />
        ) : (
          <p>{t('viewOnly')}</p>
        )}
      </div>
    </section>
  )
}

export function PollProblemSection({ channel }: { channel: Channel }) {
  const problem = pollProblemOf(channel)

  return problem && isInboundSftp(channel) ? (
    <PollProblemNotice channel={channel} problem={problem} />
  ) : null
}

function PollProblemLine({ channelId, problem }: { channelId: string; problem: PollProblem }) {
  const t = useTranslations('Channel.pollProblem')
  const tFailed = useTranslations('Channel.test.failed')
  const canChange = useCanChange()
  const since = useSince(problem)

  return (
    <div className="mt-1 flex items-start gap-1.5 text-xs whitespace-normal">
      <HugeiconsIcon
        icon={Alert02Icon}
        strokeWidth={2}
        aria-hidden
        className="text-destructive-text mt-px size-3.5 shrink-0"
      />
      <p className="flex flex-wrap gap-x-2 gap-y-0.5">
        <span className="text-destructive-text font-medium">{t.rich('listSince', since)}</span>
        <span>{tFailed(`${problem.reason}.title`)}</span>
        {canChange && <FixLink channelId={channelId} problem={problem} className="relative" />}
      </p>
    </div>
  )
}

export function PollProblemSummary({ channel }: { channel: Channel }) {
  const problem = pollProblemOf(channel)

  return problem ? <PollProblemLine channelId={channel.id} problem={problem} /> : null
}
