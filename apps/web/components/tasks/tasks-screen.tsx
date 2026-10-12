'use client'

import { ArrowRight01Icon, CheckmarkCircle02Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useQuery } from '@tanstack/react-query'
import { useFormatter, useNow, useTranslations } from 'next-intl'
import Link from 'next/link'
import { useEffect, useId, useState } from 'react'

import { AppPage } from '@/components/app-page'
import { LoadError } from '@/components/load-error'
import { TaskIcon, useTaskText } from '@/components/tasks/task-text'
import { useLocationHash } from '@/hooks/use-location-hash'
import { tasksQuery } from '@/lib/api/queries'
import { taskGroupIds, taskHref } from '@/lib/task-href'
import { type Task, type TaskActor, taskActors, type TaskCounts } from '@edi-bridge/contracts'
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

function TaskItem({ task, now }: { task: Task; now: Date }) {
  const format = useFormatter()
  const taskText = useTaskText()
  const titleId = useId()
  const { title, detail, action } = taskText(task)

  return (
    <Item role="listitem" variant="outline" className="flex-wrap sm:flex-nowrap">
      <ItemMedia variant="icon">
        <TaskIcon task={task} />
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
    <section
      id={taskGroupIds[whoActs]}
      aria-labelledby={headingId}
      className="flex scroll-mt-20 flex-col gap-3">
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
  const hash = useLocationHash()
  const byWho = Map.groupBy(tasks, (task) => task.whoActs)

  useEffect(() => {
    const target = hash === '' ? null : document.getElementById(hash)
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    target?.scrollIntoView({ behavior: reducedMotion ? 'instant' : 'smooth', block: 'start' })
  }, [hash])

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
