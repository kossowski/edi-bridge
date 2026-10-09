'use client'

import { DocumentAttachmentIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { type DragEvent, useEffect, useId, useRef, useState } from 'react'

import { linkClass } from '@/components/detail-parts'
import { describedBy, FormField, SelectField } from '@/components/form-field'
import { FailureStageLabel, RunStatusBadge } from '@/components/runs/run-status'
import { ApiError, submitDocument } from '@/lib/api/client'
import { channelsQuery, runKeys } from '@/lib/api/queries'
import { maxDocumentLength } from '@edi-bridge/contracts'
import { Button, buttonVariants } from '@edi-bridge/ui/components/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@edi-bridge/ui/components/dialog'
import { Input } from '@edi-bridge/ui/components/input'
import { cn } from '@edi-bridge/ui/lib/utils'

import type { ManualSubmission, ManualSubmissionInput } from '@edi-bridge/contracts'

type DocumentError = 'required' | 'empty' | 'tooLarge'

type Result = {
  submission: ManualSubmission
  fileName: string
  channelId: string
  channelName: string
}

const errorClass = 'text-sm text-red-800 dark:text-red-300'

function ChannelChoice({
  id,
  value,
  error,
  onChange,
}: {
  id: string
  value: string | null
  error: string | null
  onChange: (channelId: string) => void
}) {
  const t = useTranslations('ManualSubmission.channel')
  const channels = useQuery(channelsQuery)

  const inbound = (channels.data ?? [])
    .filter((channel) => channel.direction === 'inbound')
    .map((channel) => ({ value: channel.id, label: channel.name }))

  if (channels.isError) {
    return (
      <div className="flex flex-col items-start gap-2">
        <p role="alert" className={errorClass}>
          {t('error')}
        </p>
        <Button size="sm" variant="outline" onClick={() => void channels.refetch()}>
          {t('retry')}
        </Button>
      </div>
    )
  }

  if (channels.data && inbound.length === 0) {
    return (
      <div className="flex flex-col items-start gap-2 rounded-lg border p-3">
        <p className="font-medium">{t('empty.title')}</p>
        <p className="text-muted-foreground">{t('empty.description')}</p>
        <Link href="/channels/new" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
          {t('empty.action')}
        </Link>
      </div>
    )
  }

  return (
    <SelectField
      id={id}
      description={t('description')}
      disabled={channels.isPending}
      error={error}
      items={inbound}
      label={t('label')}
      placeholder={channels.isPending ? t('loading') : t('placeholder')}
      value={value}
      onChange={onChange}
    />
  )
}

function DocumentField({
  id,
  file,
  error,
  onChange,
}: {
  id: string
  file: File | null
  error: string | null
  onChange: (file: File | null) => void
}) {
  const t = useTranslations('ManualSubmission.document')
  const input = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  function drop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setDragging(false)
    const dropped = event.dataTransfer.files[0]

    if (dropped && input.current) {
      // Keeps the native input in sync, so it names the dropped file like a chosen one.
      input.current.files = event.dataTransfer.files
      onChange(dropped)
    }
  }

  return (
    <FormField
      id={id}
      description={t('description')}
      error={error}
      label={
        <label htmlFor={id} className="text-sm font-medium">
          {t('label')}
        </label>
      }>
      <div
        className={cn(
          'flex flex-col items-center gap-2 rounded-lg border border-dashed p-4 text-center transition-colors',
          dragging && 'border-ring bg-muted',
        )}
        onDragLeave={() => setDragging(false)}
        onDragOver={(event) => {
          event.preventDefault()
          setDragging(true)
        }}
        onDrop={drop}>
        <HugeiconsIcon
          icon={DocumentAttachmentIcon}
          strokeWidth={2}
          aria-hidden
          className="text-muted-foreground size-6"
        />
        <p aria-hidden className="text-muted-foreground">
          {t('drop')}
        </p>
        <Input
          id={id}
          name="document"
          ref={input}
          type="file"
          aria-describedby={describedBy(id, error)}
          aria-invalid={error !== null}
          className="h-auto py-1.5"
          onChange={(event) => onChange(event.target.files?.[0] ?? null)}
        />
        {file && <p className="text-muted-foreground font-mono text-xs break-all">{file.name}</p>}
      </div>
    </FormField>
  )
}

async function readDocument(
  file: File | null,
): Promise<{ content: string } | { error: DocumentError }> {
  if (file === null) {
    return { error: 'required' }
  }

  const content = await file.text()

  if (content.length === 0) {
    return { error: 'empty' }
  }

  return content.length > maxDocumentLength ? { error: 'tooLarge' } : { content }
}

function SubmissionForm({
  defaultChannelId,
  focusOnMount,
  onSubmitted,
}: {
  defaultChannelId: string | null
  focusOnMount: boolean
  onSubmitted: (result: Result) => void
}) {
  const t = useTranslations('ManualSubmission')
  const id = useId()
  const queryClient = useQueryClient()
  const form = useRef<HTMLFormElement>(null)
  const [channelId, setChannelId] = useState(defaultChannelId)
  const [file, setFile] = useState<File | null>(null)
  const [channelError, setChannelError] = useState(false)
  const [documentError, setDocumentError] = useState<DocumentError | null>(null)

  const submission = useMutation({
    mutationFn: (input: ManualSubmissionInput) => submitDocument(input),
    onSuccess: (submitted, input) => {
      void queryClient.invalidateQueries({ queryKey: runKeys.lists() })
      const channels = queryClient.getQueryData(channelsQuery.queryKey)

      onSubmitted({
        submission: submitted,
        fileName: input.document.fileName,
        channelId: input.channelId,
        channelName: channels?.find((channel) => channel.id === input.channelId)?.name ?? '',
      })
    },
  })

  async function submit() {
    const read = await readDocument(file)
    const missingChannel = channelId === null

    setChannelError(missingChannel)
    setDocumentError('error' in read ? read.error : null)

    if (!missingChannel && file !== null && 'content' in read) {
      submission.mutate({ channelId, document: { fileName: file.name, content: read.content } })
    } else {
      document.getElementById(missingChannel ? `${id}-channel` : `${id}-document`)?.focus()
    }
  }

  useEffect(() => {
    if (focusOnMount) {
      form.current?.querySelector<HTMLElement>('button, input')?.focus()
    }
  }, [focusOnMount])

  return (
    <form
      noValidate
      ref={form}
      aria-busy={submission.isPending}
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}>
      <ChannelChoice
        id={`${id}-channel`}
        error={channelError ? t('errors.channelRequired') : null}
        value={channelId}
        onChange={(next) => {
          setChannelId(next)
          setChannelError(false)
        }}
      />
      <DocumentField
        id={`${id}-document`}
        error={documentError ? t(`errors.document.${documentError}`) : null}
        file={file}
        onChange={(next) => {
          setFile(next)
          setDocumentError(null)
        }}
      />
      {submission.isError && (
        <p role="alert" className={errorClass}>
          {submission.error instanceof ApiError && submission.error.status === 422
            ? t('errors.unroutable')
            : t('errors.failed')}
        </p>
      )}
      <DialogFooter>
        <DialogClose render={<Button variant="outline" />}>{t('cancel')}</DialogClose>
        <Button disabled={submission.isPending} type="submit">
          {submission.isPending ? t('submitting') : t('submit')}
        </Button>
      </DialogFooter>
    </form>
  )
}

function SubmissionResult({ result, onAnother }: { result: Result; onAnother: () => void }) {
  const t = useTranslations('ManualSubmission.result')
  const heading = useRef<HTMLHeadingElement>(null)
  const { runs } = result.submission

  useEffect(() => {
    heading.current?.focus()
  }, [])

  return (
    <section aria-labelledby="manual-submission-result" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h3
          id="manual-submission-result"
          ref={heading}
          tabIndex={-1}
          className="font-medium outline-none">
          {t('title', { count: runs.length })}
        </h3>
        <p className="text-muted-foreground break-words">
          {t('description', { fileName: result.fileName, channel: result.channelName })}
        </p>
      </div>
      <ul className="flex max-h-72 flex-col divide-y overflow-y-auto rounded-lg border">
        {runs.map((run) => (
          <li key={run.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
            <div className="flex min-w-0 flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <RunStatusBadge status={run.status} />
                {run.failureStage && <FailureStageLabel failureStage={run.failureStage} />}
              </div>
              <p className="text-muted-foreground">
                {t('run', {
                  messageType: run.messageType,
                  tradingPartner: run.tradingPartner.name,
                  flow: run.flow.name,
                })}
              </p>
            </div>
            <Link href={`/runs/${run.id}`} className={linkClass}>
              {t('open')}
              <span className="sr-only">
                {' '}
                {t('openContext', {
                  messageType: run.messageType,
                  tradingPartner: run.tradingPartner.name,
                })}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <DialogFooter>
        <Button variant="outline" onClick={onAnother}>
          {t('another')}
        </Button>
        <DialogClose render={<Button />}>{t('done')}</DialogClose>
      </DialogFooter>
    </section>
  )
}

export function ManualSubmissionDialog({
  defaultChannelId = null,
  defaultOpen = false,
}: {
  defaultChannelId?: string | null
  defaultOpen?: boolean
}) {
  const t = useTranslations('ManualSubmission')
  const [result, setResult] = useState<Result | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [channelId, setChannelId] = useState(defaultChannelId)

  return (
    <Dialog
      defaultOpen={defaultOpen}
      onOpenChangeComplete={(open) => {
        if (!open) {
          setResult(null)
          setChannelId(defaultChannelId)
          setAttempt(0)
        }
      }}>
      <DialogTrigger render={<Button variant="outline" />}>
        <HugeiconsIcon icon={DocumentAttachmentIcon} strokeWidth={2} aria-hidden />
        {t('open')}
      </DialogTrigger>
      <DialogContent closeLabel={t('close')} className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        {result ? (
          <SubmissionResult
            result={result}
            onAnother={() => {
              setChannelId(result.channelId)
              setResult(null)
              setAttempt((count) => count + 1)
            }}
          />
        ) : (
          <SubmissionForm
            key={attempt}
            defaultChannelId={channelId}
            focusOnMount={attempt > 0}
            onSubmitted={setResult}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
