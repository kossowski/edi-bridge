'use client'

import {
  Alert02Icon,
  ArrowRight01Icon,
  CheckmarkCircle02Icon,
  Clock01Icon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useQuery } from '@tanstack/react-query'
import { useFormatter, useNow, useTranslations } from 'next-intl'
import Link from 'next/link'
import { useId, useState } from 'react'

import { AppPage } from '@/components/app-page'
import { LoadError } from '@/components/load-error'
import { usePlainNames } from '@/components/plain-names'
import { Term } from '@/components/term'
import { tasksQuery } from '@/lib/api/queries'
import { taskHref } from '@/lib/task-href'
import {
  directionOf,
  type Task,
  type TaskActor,
  taskActors,
  type TaskCounts,
} from '@edi-bridge/contracts'
import { Button, buttonVariants } from '@edi-bridge/ui/components/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@edi-bridge/ui/components/empty'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from '@edi-bridge/ui/components/item'
import { Skeleton } from '@edi-bridge/ui/components/skeleton'

const topCount = 10

function useTaskText() {
  const t = useTranslations('Tasks')
  const plainNames = usePlainNames()

  return (task: Task) => {
    const partner = task.tradingPartner.name

    switch (task.kind) {
      case 'failedRun': {
        return {
          title: plainNames.failureStageTitle(task.run.failureStage),
          detail: t('failedRun.detail', {
            direction: directionOf(task.run),
            messageType: plainNames.messageTypeName(task.run.messageType),
            partner,
          }),
          action: t(`failedRun.action.${task.whoActs}`),
        }
      }

      case 'overdueAcknowledgement': {
        return {
          title: t('overdueAcknowledgement.title', { partner }),
          detail: t.rich('overdueAcknowledgement.detail', {
            messageType: plainNames.messageTypeName(task.messageType),
            controlReference: task.interchange.controlReference,
            hours: task.acknowledgementTimeLimitHours,
            term: (chunks) => <Term glossaryKey="acknowledgement">{chunks}</Term>,
          }),
          action: t('overdueAcknowledgement.action'),
        }
      }

      case 'failingTradingPartner': {
        return {
          title: t('failingTradingPartner.title', { partner }),
          detail: t('failingTradingPartner.detail', {
            failed: task.failed,
            total: task.delivered + task.failed,
          }),
          action: t('failingTradingPartner.action'),
        }
      }
    }
  }
}

function TaskItem({ task, now }: { task: Task; now: Date }) {
  const format = useFormatter()
  const taskText = useTaskText()
  const titleId = useId()
  const { title, detail, action } = taskText(task)
  const waiting = task.kind === 'overdueAcknowledgement'

  return (
    <Item role="listitem" variant="outline" className="flex-wrap sm:flex-nowrap">
      <ItemMedia variant="icon">
        <HugeiconsIcon
          icon={waiting ? Clock01Icon : Alert02Icon}
          strokeWidth={2}
          aria-hidden
          className={waiting ? 'text-muted-foreground' : 'text-destructive'}
        />
      </ItemMedia>
      <ItemContent className="min-w-0">
        <ItemTitle>
          <h3 id={titleId}>{title}</h3>
        </ItemTitle>
        <ItemDescription className="line-clamp-none">
          {detail} &middot;{' '}
          <time dateTime={task.at}>{format.relativeTime(new Date(task.at), now)}</time>
        </ItemDescription>
      </ItemContent>
      <ItemActions className="w-full sm:w-auto">
        <Link
          href={taskHref(task.target)}
          aria-describedby={titleId}
          className={buttonVariants({
            variant: task.whoActs === 'you' ? 'default' : 'outline',
            className: 'w-full sm:w-auto',
          })}>
          {action}
          <HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={2} data-icon="inline-end" />
        </Link>
      </ItemActions>
    </Item>
  )
}

function TaskGroup({
  whoActs,
  tasks,
  count,
  now,
}: {
  whoActs: TaskActor
  tasks: ReadonlyArray<Task>
  count: number
  now: Date
}) {
  const t = useTranslations('Tasks')
  const [expanded, setExpanded] = useState(false)
  const headingId = useId()
  const listId = useId()
  const shown = expanded ? tasks : tasks.slice(0, topCount)

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <h2 id={headingId} className="text-sm font-medium">
        {t(`groups.${whoActs}`)} <span className="text-muted-foreground">({count})</span>
      </h2>
      <ItemGroup id={listId} className="gap-2">
        {shown.map((task) => (
          <TaskItem key={task.id} now={now} task={task} />
        ))}
      </ItemGroup>
      {tasks.length > topCount && (
        <Button
          size="sm"
          variant="outline"
          aria-controls={listId}
          aria-expanded={expanded}
          className="self-start"
          onClick={() => setExpanded((value) => !value)}>
          {expanded ? t('showNewest', { count: topCount }) : t('showAll', { count: tasks.length })}
        </Button>
      )}
    </section>
  )
}

function TaskGroups({ tasks, counts }: { tasks: ReadonlyArray<Task>; counts: TaskCounts }) {
  const now = useNow({ updateInterval: 60_000 })
  const byWho = Map.groupBy(tasks, (task) => task.whoActs)

  return taskActors.map((whoActs) => {
    const groupTasks = byWho.get(whoActs)

    return groupTasks ? (
      <TaskGroup
        key={whoActs}
        count={counts[whoActs]}
        now={now}
        tasks={groupTasks}
        whoActs={whoActs}
      />
    ) : null
  })
}

function AllGood() {
  const t = useTranslations('Tasks.empty')

  return (
    <Empty className="border border-dashed">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <HugeiconsIcon icon={CheckmarkCircle02Icon} strokeWidth={2} />
        </EmptyMedia>
        <EmptyTitle>
          <h2>{t('title')}</h2>
        </EmptyTitle>
        <EmptyDescription>{t('description')}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent className="flex-row justify-center">
        <Link href="/" className={buttonVariants({ variant: 'outline' })}>
          {t('home')}
        </Link>
      </EmptyContent>
    </Empty>
  )
}

function LoadingTasks() {
  return (
    <div aria-hidden className="flex flex-col gap-3">
      <Skeleton className="h-5 w-40" />
      {Array.from({ length: 4 }, (_, index) => (
        <div key={index} className="flex items-center gap-4 rounded-lg border p-4">
          <Skeleton className="size-8" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-4 w-64 max-w-full" />
            <Skeleton className="h-4 w-48 max-w-full" />
          </div>
          <Skeleton className="hidden h-8 w-28 sm:block" />
        </div>
      ))}
    </div>
  )
}

export function TasksScreen() {
  const t = useTranslations()
  const { data, isError, isPending, refetch } = useQuery(tasksQuery)

  function content() {
    if (isError) {
      return (
        <LoadError
          description={t('Tasks.error.description')}
          retryLabel={t('Tasks.error.retry')}
          title={t('Tasks.error.title')}
          onRetry={() => void refetch()}
        />
      )
    }

    if (isPending) {
      return <LoadingTasks />
    }

    return data.tasks.length === 0 ? (
      <AllGood />
    ) : (
      <TaskGroups counts={data.counts} tasks={data.tasks} />
    )
  }

  return (
    <AppPage busy={isPending && !isError} title={t('Pages.tasks.label')}>
      <p className="text-muted-foreground max-w-prose text-sm">{t('Tasks.intro')}</p>
      <p aria-live="polite" className="sr-only">
        {isPending && !isError ? t('Tasks.loading') : ''}
      </p>
      <div className="flex flex-col gap-8">{content()}</div>
    </AppPage>
  )
}
