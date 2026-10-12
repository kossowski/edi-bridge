'use client'

import { CheckmarkCircle02Icon, Notification03Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useQuery } from '@tanstack/react-query'
import { useFormatter, useNow, useTranslations } from 'next-intl'
import Link from 'next/link'
import { useRef, useState } from 'react'

import { TaskIcon, useTaskText } from '@/components/tasks/task-text'
import { tasksQuery } from '@/lib/api/queries'
import { taskHref } from '@/lib/task-href'
import { type Task, taskActors, type Tasks } from '@edi-bridge/contracts'
import { Button, buttonVariants } from '@edi-bridge/ui/components/button'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@edi-bridge/ui/components/empty'
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverTitle,
  PopoverTrigger,
} from '@edi-bridge/ui/components/popover'
import { Skeleton } from '@edi-bridge/ui/components/skeleton'

const newestCount = 6

const badgeLimit = 99

function TaskRow({ task, now, onOpen }: { task: Task; now: Date; onOpen: () => void }) {
  const format = useFormatter()
  const taskText = useTaskText({ glossaryLinks: false })
  const { title, detail } = taskText(task)

  return (
    <li>
      <Link
        href={taskHref(task.target)}
        className="hover:bg-muted/50 focus-visible:ring-ring/50 flex gap-2.5 px-3 py-2.5 outline-none focus-visible:ring-[3px] focus-visible:ring-inset [&_svg]:mt-0.5 [&_svg]:size-4 [&_svg]:shrink-0"
        onClick={onOpen}>
        <TaskIcon task={task} />
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="font-medium">{title}</span>
          <span className="text-muted-foreground text-xs">
            {detail} &middot;{' '}
            <time dateTime={task.at}>{format.relativeTime(new Date(task.at), now)}</time>
          </span>
        </span>
      </Link>
    </li>
  )
}

function NewestTasks({ data, onOpen }: { data: Tasks; onOpen: () => void }) {
  const t = useTranslations()
  const now = useNow({ updateInterval: 60_000 })
  const newest = data.tasks.slice(0, newestCount)

  if (data.tasks.length === 0) {
    return (
      <Empty className="gap-2 px-3 py-6">
        <EmptyHeader className="gap-1">
          <EmptyMedia variant="icon">
            <HugeiconsIcon icon={CheckmarkCircle02Icon} strokeWidth={2} />
          </EmptyMedia>
          <EmptyTitle>{t('Tasks.empty.title')}</EmptyTitle>
          <EmptyDescription className="text-xs">{t('Tasks.empty.description')}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <>
      <ul className="max-h-[36rem] min-h-0 divide-y overflow-y-auto">
        {newest.map((task) => (
          <TaskRow key={task.id} now={now} task={task} onOpen={onOpen} />
        ))}
      </ul>
      {data.tasks.length > newest.length && (
        <p className="text-muted-foreground shrink-0 border-t px-3 py-2 text-xs">
          {t('TaskBell.newest', { shown: newest.length, count: data.tasks.length })}
        </p>
      )}
    </>
  )
}

function LoadingTasks() {
  const t = useTranslations('TaskBell')

  return (
    <div className="flex flex-col gap-3 px-3 py-3">
      <span className="sr-only">{t('loading')}</span>
      {Array.from({ length: 3 }, (_, index) => (
        <div key={index} aria-hidden className="flex gap-2.5">
          <Skeleton className="size-4" />
          <div className="flex flex-1 flex-col gap-1.5">
            <Skeleton className="h-4 w-48 max-w-full" />
            <Skeleton className="h-3 w-36 max-w-full" />
          </div>
        </div>
      ))}
    </div>
  )
}

export function TaskBell() {
  const t = useTranslations('TaskBell')
  const [open, setOpen] = useState(false)
  const { data, isError, isPending } = useQuery(tasksQuery)
  const count = data?.tasks.length ?? 0
  const shownCount = count > badgeLimit ? `${badgeLimit}+` : String(count)
  const navigating = useRef(false)
  const close = () => setOpen(false)

  function navigate() {
    navigating.current = true
    close()
  }

  function focusAfterClose() {
    if (!navigating.current) {
      return true
    }

    navigating.current = false

    return document.getElementById('main-content') ?? false
  }

  function content() {
    if (isError) {
      return <p className="px-3 py-4">{t('error')}</p>
    }

    if (isPending) {
      return <LoadingTasks />
    }

    return <NewestTasks data={data} onOpen={navigate} />
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={data ? t('label', { count, shownCount }) : t('title')}
            className="relative"
          />
        }>
        <HugeiconsIcon icon={Notification03Icon} strokeWidth={2} />
        {count > 0 && (
          <span
            aria-hidden
            className="bg-destructive ring-background text-background absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] leading-none font-semibold tabular-nums ring-2">
            {shownCount}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent
        align="end"
        finalFocus={focusAfterClose}
        className="max-h-(--available-height) w-[min(22rem,calc(100vw-2rem))] gap-0 p-0">
        <div className="flex shrink-0 flex-col gap-0.5 border-b px-3 py-2.5">
          <PopoverTitle>{t('title')}</PopoverTitle>
          {data && data.tasks.length > 0 && (
            <PopoverDescription className="text-xs">
              {taskActors
                .map((whoActs) => t(`counts.${whoActs}`, { count: data.counts[whoActs] }))
                .join(' · ')}
            </PopoverDescription>
          )}
        </div>
        {content()}
        <div className="shrink-0 border-t p-2">
          <Link
            href="/tasks"
            className={buttonVariants({ size: 'sm', variant: 'outline', className: 'w-full' })}
            onClick={navigate}>
            {t('all')}
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  )
}
