'use client'

import { DocumentAttachmentIcon, PlugSocketIcon, Upload01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { type DragEvent, useEffect, useId, useRef, useState } from 'react'

import { useChannelKindLabel, useChannelTradingPartners } from '@/components/channels/channel-parts'
import { useRunTitle } from '@/components/documents/run-row'
import {
  documentProblem,
  type DocumentProblem,
  knownMessageType,
} from '@/components/documents/upload-document'
import { describedBy, FormField, SelectField } from '@/components/form-field'
import { MessageTypeName, usePlainNames } from '@/components/plain-names'
import { RunStatusBadge } from '@/components/runs/run-status'
import { useLookup } from '@/hooks/use-lookup'
import { ApiError, submitDocument } from '@/lib/api/client'
import { channelsQuery, interchangeKeys, runKeys } from '@/lib/api/queries'
import { runHref } from '@/lib/navigation'
import { Alert, AlertDescription } from '@edi-bridge/ui/components/alert'
import { Button, buttonVariants } from '@edi-bridge/ui/components/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@edi-bridge/ui/components/empty'
import { Input } from '@edi-bridge/ui/components/input'
import { Item, ItemActions, ItemContent, ItemTitle } from '@edi-bridge/ui/components/item'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@edi-bridge/ui/components/sheet'
import { Spinner } from '@edi-bridge/ui/components/spinner'
import { cn } from '@edi-bridge/ui/lib/utils'

import type {
  Channel,
  ManualSubmission,
  ManualSubmissionInput,
  RunSummary,
} from '@edi-bridge/contracts'

type Upload = {
  submission: ManualSubmission
  fileName: string
  channelId: string
  channelName: string
}

function useInboundChannels() {
  const channels = useLookup(channelsQuery)

  return {
    ...channels,
    inbound: (channels.data ?? []).filter((channel) => channel.direction === 'inbound'),
  }
}

function ChannelChoice({
  id,
  inbound,
  loading,
  value,
  error,
  onChange,
}: {
  id: string
  inbound: Channel[]
  loading: boolean
  value: string | null
  error: string | null
  onChange: (channelId: string) => void
}) {
  const t = useTranslations('Upload.channel')
  const kindLabel = useChannelKindLabel()
  const tradingPartners = useChannelTradingPartners()

  return (
    <SelectField
      id={id}
      description={t('description')}
      error={error}
      items={inbound.map((channel) => ({
        value: channel.id,
        label: channel.name,
        detail: t('detail', {
          kind: kindLabel(channel),
          tradingPartner: tradingPartners.name(channel.tradingPartnerId),
        }),
      }))}
      label={t('label')}
      loading={loading}
      placeholder={loading ? t('loading') : t('placeholder')}
      value={value}
      className="w-full"
      onChange={onChange}
    />
  )
}

function ChannelsUnavailable({ onRetry }: { onRetry: () => void }) {
  const t = useTranslations('Upload.channel')

  return (
    <Alert variant="destructive">
      <AlertDescription className="flex flex-col items-start gap-2">
        <p>{t('error')}</p>
        <Button size="sm" variant="outline" onClick={onRetry}>
          {t('retry')}
        </Button>
      </AlertDescription>
    </Alert>
  )
}

function NoInboundChannels() {
  const t = useTranslations('Upload.channel.empty')

  return (
    <Empty className="border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <HugeiconsIcon icon={PlugSocketIcon} strokeWidth={2} aria-hidden />
        </EmptyMedia>
        <EmptyTitle>{t('title')}</EmptyTitle>
        <EmptyDescription>{t('description')}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Link href="/channels/new" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
          {t('action')}
        </Link>
      </EmptyContent>
    </Empty>
  )
}

function FileField({
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
  const t = useTranslations('Upload.file')
  const input = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  function drop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setDragging(false)
    const dropped = event.dataTransfer.files[0]

    if (dropped && input.current) {
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
          'flex flex-col items-center gap-3 rounded-lg border border-dashed p-6 text-center transition-colors',
          dragging && 'border-ring bg-muted',
          error !== null && 'border-destructive/50',
        )}
        onDragLeave={() => setDragging(false)}
        onDragOver={(event) => {
          event.preventDefault()
          setDragging(true)
        }}
        onDrop={drop}>
        <HugeiconsIcon
          icon={DocumentAttachmentIcon}
          strokeWidth={1.5}
          aria-hidden
          className="text-muted-foreground size-8"
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
        {file && (
          <p className="font-mono text-xs break-all">{t('chosen', { fileName: file.name })}</p>
        )}
      </div>
    </FormField>
  )
}

function UploadFailure({ error, onRetry }: { error: Error; onRetry: () => void }) {
  const t = useTranslations('Upload.errors')
  const unroutable = error instanceof ApiError && error.status === 422

  return (
    <Alert variant="destructive">
      <AlertDescription className="flex flex-col items-start gap-2">
        <p>{unroutable ? t('unroutable') : t('failed')}</p>
        {unroutable ? (
          <Link href="/flows/new" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
            {t('newFlow')}
          </Link>
        ) : (
          <Button size="sm" variant="outline" onClick={onRetry}>
            {t('retry')}
          </Button>
        )}
      </AlertDescription>
    </Alert>
  )
}

async function readFile(file: File | null) {
  const content = file === null ? null : await file.text()

  return { content, problem: documentProblem(content) }
}

function UploadForm({
  defaultChannelId,
  focusFile,
  onUploaded,
}: {
  defaultChannelId: string | null
  focusFile: boolean
  onUploaded: (upload: Upload) => void
}) {
  const t = useTranslations('Upload')
  const id = useId()
  const queryClient = useQueryClient()
  const channels = useInboundChannels()
  const [channelId, setChannelId] = useState(defaultChannelId)
  const [file, setFile] = useState<File | null>(null)
  const [channelError, setChannelError] = useState(false)
  const [fileProblem, setFileProblem] = useState<DocumentProblem | null>(null)

  const upload = useMutation({
    mutationFn: (input: ManualSubmissionInput) => submitDocument(input),
    onSuccess: (submission, input) => {
      void queryClient.invalidateQueries({ queryKey: runKeys.lists() })
      void queryClient.invalidateQueries({ queryKey: interchangeKeys.all() })

      onUploaded({
        submission,
        fileName: input.document.fileName,
        channelId: input.channelId,
        channelName: channels.find(input.channelId)?.name ?? '',
      })
    },
  })

  async function submit() {
    const { content, problem } = await readFile(file)
    const missingChannel = channelId === null

    setChannelError(missingChannel)
    setFileProblem(problem)

    if (!missingChannel && file !== null && content !== null && problem === null) {
      upload.mutate({ channelId, document: { fileName: file.name, content } })
    } else {
      document.getElementById(missingChannel ? `${id}-channel` : `${id}-file`)?.focus()
    }
  }

  useEffect(() => {
    if (focusFile) {
      document.getElementById(`${id}-file`)?.focus()
    }
  }, [focusFile, id])

  if (channels.data && channels.inbound.length === 0) {
    return (
      <>
        <div className="flex-1 overflow-y-auto px-4">
          <NoInboundChannels />
        </div>
        <SheetFooter className="flex-row justify-end border-t">
          <SheetClose render={<Button variant="outline" />}>{t('cancel')}</SheetClose>
        </SheetFooter>
      </>
    )
  }

  return (
    <form
      noValidate
      aria-busy={upload.isPending}
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}>
      <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-4 pb-4">
        {channels.isError ? (
          <ChannelsUnavailable onRetry={() => void channels.refetch()} />
        ) : (
          <ChannelChoice
            id={`${id}-channel`}
            error={channelError ? t('errors.channelRequired') : null}
            inbound={channels.inbound}
            loading={channels.isPending}
            value={channelId}
            onChange={(next) => {
              setChannelId(next)
              setChannelError(false)
            }}
          />
        )}
        <FileField
          id={`${id}-file`}
          error={fileProblem ? t(`errors.file.${fileProblem}`) : null}
          file={file}
          onChange={(next) => {
            setFile(next)
            setFileProblem(null)
            upload.reset()
          }}
        />
        {upload.isError && <UploadFailure error={upload.error} onRetry={() => void submit()} />}
      </div>
      <SheetFooter className="flex-row justify-end border-t">
        <SheetClose render={<Button variant="outline" />}>{t('cancel')}</SheetClose>
        <Button disabled={upload.isPending} type="submit">
          {upload.isPending && <Spinner aria-hidden data-icon="inline-start" />}
          {upload.isPending ? t('submitting') : t('submit')}
        </Button>
      </SheetFooter>
    </form>
  )
}

function CreatedRun({ run }: { run: RunSummary }) {
  const t = useTranslations('Upload.result')
  const plainNames = usePlainNames()
  const title = useRunTitle(run)

  return (
    <Item render={<li />} size="sm" variant="outline" className="items-start">
      <ItemContent className="min-w-0 gap-1.5">
        <ItemTitle className="line-clamp-none w-full">{title}</ItemTitle>
        <div className="flex flex-wrap items-center gap-2">
          <RunStatusBadge status={run.status} />
          {run.failureStage !== null && (
            <span className="text-destructive text-sm">
              {plainNames.failureStageTitle(run.failureStage)}
            </span>
          )}
        </div>
      </ItemContent>
      <ItemActions>
        <Link href={runHref(run.id)} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
          {t('open')}
          <span className="sr-only">: {title}</span>
        </Link>
      </ItemActions>
    </Item>
  )
}

function NotRouted({
  notRouted,
  channelName,
}: {
  notRouted: ManualSubmission['notRouted']
  channelName: string
}) {
  const t = useTranslations('Upload.result.notRouted')

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-dashed p-3">
      <p className="font-medium">{t('title', { count: notRouted.length })}</p>
      <p className="text-muted-foreground">{t('description', { channel: channelName })}</p>
      <ul className="flex flex-col gap-1">
        {notRouted.map(({ messageType }, index) => {
          const known = knownMessageType(messageType)

          return (
            // The same Message Type can occur several times in one Interchange.
            <li key={index}>
              {known ? (
                <MessageTypeName messageType={known} />
              ) : (
                <span className="font-mono text-xs">{messageType}</span>
              )}
            </li>
          )
        })}
      </ul>
      <Link
        href="/flows/new"
        className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'self-start')}>
        {t('action')}
      </Link>
    </div>
  )
}

function UploadResult({ upload, onAnother }: { upload: Upload; onAnother: () => void }) {
  const t = useTranslations('Upload.result')
  const id = useId()
  const heading = useRef<HTMLHeadingElement>(null)
  const { runs, notRouted } = upload.submission

  useEffect(() => {
    heading.current?.focus()
  }, [])

  return (
    <section aria-labelledby={`${id}-title`} className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 pb-4">
        <div className="flex flex-col gap-1">
          <h3 id={`${id}-title`} ref={heading} tabIndex={-1} className="font-medium outline-none">
            {t('title', { count: runs.length })}
          </h3>
          <p className="text-muted-foreground break-words">
            {t('description', { fileName: upload.fileName, channel: upload.channelName })}
          </p>
        </div>
        <ul aria-label={t('list')} className="flex flex-col gap-2">
          {runs.map((run) => (
            <CreatedRun key={run.id} run={run} />
          ))}
        </ul>
        {notRouted.length > 0 && (
          <NotRouted channelName={upload.channelName} notRouted={notRouted} />
        )}
      </div>
      <SheetFooter className="flex-row flex-wrap justify-end border-t">
        <Button variant="outline" onClick={onAnother}>
          {t('another')}
        </Button>
        <SheetClose render={<Button />}>{t('done')}</SheetClose>
      </SheetFooter>
    </section>
  )
}

export function UploadSheet({
  defaultChannelId = null,
  defaultOpen = false,
}: {
  defaultChannelId?: string | null
  defaultOpen?: boolean
}) {
  const t = useTranslations('Upload')
  const [upload, setUpload] = useState<Upload | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [channelId, setChannelId] = useState(defaultChannelId)

  return (
    <Sheet
      defaultOpen={defaultOpen}
      onOpenChangeComplete={(open) => {
        if (!open) {
          setUpload(null)
          setChannelId(defaultChannelId)
          setAttempt(0)
        }
      }}>
      <SheetTrigger render={<Button variant="outline" />}>
        <HugeiconsIcon icon={Upload01Icon} strokeWidth={2} aria-hidden data-icon="inline-start" />
        {t('open')}
      </SheetTrigger>
      <SheetContent
        closeLabel={t('close')}
        className="gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-md">
        <SheetHeader className="pr-12">
          <SheetTitle>{t('title')}</SheetTitle>
          <SheetDescription>{t('description')}</SheetDescription>
        </SheetHeader>
        {upload ? (
          <UploadResult
            upload={upload}
            onAnother={() => {
              setChannelId(upload.channelId)
              setUpload(null)
              setAttempt((count) => count + 1)
            }}
          />
        ) : (
          <UploadForm
            key={attempt}
            defaultChannelId={channelId}
            focusFile={attempt > 0}
            onUploaded={setUpload}
          />
        )}
      </SheetContent>
    </Sheet>
  )
}
