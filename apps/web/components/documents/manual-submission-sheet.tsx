'use client'

import { DocumentAttachmentIcon, PlugSocketIcon, Upload01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { type DragEvent, type ReactNode, useEffect, useId, useRef, useState } from 'react'

import { useChannelKindLabel, useChannelTradingPartners } from '@/components/channels/channel-parts'
import {
  documentProblem,
  type DocumentProblem,
  namesItsCharacterSet,
  parseMessageType,
} from '@/components/documents/manual-submission'
import { RunStatusBadge } from '@/components/documents/run-status'
import { useRunTitle } from '@/components/documents/run-title'
import { describedBy, FormField, SelectField } from '@/components/form-field'
import { MessageTypeName, usePlainNames } from '@/components/plain-names'
import { useLookup } from '@/hooks/use-lookup'
import { ApiError, documentUndecodableOf, submitDocument } from '@/lib/api/client'
import {
  channelsQuery,
  interchangeKeys,
  orderLifecycleKeys,
  homeKeys,
  runKeys,
} from '@/lib/api/queries'
import { encodingLabels } from '@/lib/encoding-labels'
import { documentHref } from '@/lib/navigation'
import { type CharacterEncoding, characterEncodings, encodeBase64 } from '@edi-bridge/contracts'
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
  RunSummary,
  SubmittedDocument,
} from '@edi-bridge/contracts'

type Submitted = {
  submission: ManualSubmission
  fileName: string
  channel: Channel
}

type Step = { name: 'form'; focusFile: boolean } | { name: 'result'; submitted: Submitted }

const firstStep: Step = { name: 'form', focusFile: false }

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
  const t = useTranslations('ManualSubmission.channel')
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

function EncodingChoice({
  id,
  value,
  onChange,
}: {
  id: string
  value: CharacterEncoding
  onChange: (encoding: CharacterEncoding) => void
}) {
  const t = useTranslations('ManualSubmission.encoding')

  return (
    <SelectField
      id={id}
      description={t('description')}
      items={characterEncodings.map((encoding) => ({
        value: encoding,
        label: encodingLabels[encoding],
      }))}
      label={t('label')}
      value={value}
      className="w-full"
      onChange={onChange}
    />
  )
}

function FailureAlert({ message, children }: { message: string; children?: ReactNode }) {
  return (
    <Alert variant="destructive">
      <AlertDescription className="flex flex-col items-start gap-2">
        <p>{message}</p>
        {children}
      </AlertDescription>
    </Alert>
  )
}

function RetryButton({ onRetry }: { onRetry: () => void }) {
  const t = useTranslations('ManualSubmission')

  return (
    <Button size="sm" variant="outline" onClick={onRetry}>
      {t('retry')}
    </Button>
  )
}

function NewFlowLink() {
  const t = useTranslations('ManualSubmission')

  return (
    <Link
      href="/flows/new"
      className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'self-start')}>
      {t('newFlow')}
    </Link>
  )
}

function NoInboundChannels() {
  const t = useTranslations('ManualSubmission.channel.empty')

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
  const t = useTranslations('ManualSubmission.file')
  const input = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  // A file that could not be read is dropped, so choosing the same file again fires a change.
  useEffect(() => {
    if (file === null && input.current) {
      input.current.value = ''
    }
  }, [file])

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

function ManualSubmissionFailure({ error, onRetry }: { error: Error; onRetry: () => void }) {
  const t = useTranslations('ManualSubmission.errors')
  const undecodable = documentUndecodableOf(error)

  if (undecodable !== null) {
    return (
      <FailureAlert
        message={
          undecodable.encoding === null
            ? t('undecodable.interchange')
            : t('undecodable.encoding', { encoding: encodingLabels[undecodable.encoding] })
        }>
        <p className="break-words">{t('undecodable.details', { reason: undecodable.reason })}</p>
      </FailureAlert>
    )
  }

  const unroutable = error instanceof ApiError && error.status === 422

  return (
    <FailureAlert message={unroutable ? t('unroutable') : t('failed')}>
      {unroutable ? <NewFlowLink /> : <RetryButton onRetry={onRetry} />}
    </FailureAlert>
  )
}

function FormFooter({ children }: { children?: ReactNode }) {
  const t = useTranslations('ManualSubmission')

  return (
    <SheetFooter className="flex-row justify-end border-t">
      <SheetClose render={<Button variant="outline" />}>{t('cancel')}</SheetClose>
      {children}
    </SheetFooter>
  )
}

type ChosenFile = { file: File; bytes: Uint8Array; namesItsCharacterSet: boolean }

async function readFile(file: File): Promise<ChosenFile> {
  const bytes = new Uint8Array(await file.arrayBuffer())

  return { file, bytes, namesItsCharacterSet: namesItsCharacterSet(bytes) }
}

function ManualSubmissionForm({
  channelId,
  focusFile,
  onChannelChange,
  onSubmitted,
}: {
  channelId: string | null
  focusFile: boolean
  onChannelChange: (channelId: string) => void
  onSubmitted: (submitted: Submitted) => void
}) {
  const t = useTranslations('ManualSubmission')
  const id = useId()
  const queryClient = useQueryClient()
  const channels = useInboundChannels()
  const [file, setFile] = useState<File | null>(null)
  const [chosen, setChosen] = useState<ChosenFile | null>(null)
  const [encoding, setEncoding] = useState<CharacterEncoding>('utf-8')
  const latestFile = useRef<File | null>(null)
  const [channelError, setChannelError] = useState(false)
  const [fileProblem, setFileProblem] = useState<DocumentProblem | 'unreadable' | null>(null)

  const submission = useMutation({
    mutationFn: (input: { channel: Channel; document: SubmittedDocument }) =>
      submitDocument({ channelId: input.channel.id, document: input.document }),
    onSuccess: (result, input) => {
      for (const queryKey of [
        runKeys.lists(),
        interchangeKeys.all(),
        homeKeys.all(),
        orderLifecycleKeys.all(),
      ]) {
        void queryClient.invalidateQueries({ queryKey })
      }

      onSubmitted({ submission: result, fileName: input.document.fileName, channel: input.channel })
    },
  })

  const read = chosen !== null && chosen.file === file ? chosen : null

  function choose(next: File | null) {
    latestFile.current = next
    setFile(next)
    setEncoding('utf-8')
    setFileProblem(null)
    submission.reset()

    if (next !== null) {
      void readFile(next).then(
        (result) => {
          if (latestFile.current === next) {
            setChosen(result)
          }
        },
        () => {
          if (latestFile.current === next) {
            latestFile.current = null
            setFile(null)
            setFileProblem('unreadable')
          }
        },
      )
    }
  }

  function submit() {
    const problem = documentProblem(read?.bytes ?? null)
    const channel = channels.find(channelId)

    setChannelError(channel === undefined)
    setFileProblem(problem)

    if (channel !== undefined && read !== null && problem === null) {
      submission.mutate({
        channel,
        document: {
          fileName: read.file.name,
          content: encodeBase64(read.bytes),
          encoding: read.namesItsCharacterSet ? undefined : encoding,
        },
      })
    } else {
      document.getElementById(channel === undefined ? `${id}-channel` : `${id}-file`)?.focus()
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
        <FormFooter />
      </>
    )
  }

  return (
    <form
      noValidate
      aria-busy={submission.isPending}
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}>
      <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-4 pb-4">
        {channels.isError ? (
          <FailureAlert message={t('channel.error')}>
            <RetryButton onRetry={() => void channels.refetch()} />
          </FailureAlert>
        ) : (
          <ChannelChoice
            id={`${id}-channel`}
            error={channelError ? t('errors.channelRequired') : null}
            inbound={channels.inbound}
            loading={channels.isPending}
            value={channelId}
            onChange={(next) => {
              onChannelChange(next)
              setChannelError(false)
              submission.reset()
            }}
          />
        )}
        <FileField
          id={`${id}-file`}
          error={fileProblem ? t(`errors.file.${fileProblem}`) : null}
          file={file}
          onChange={choose}
        />
        {read !== null && !read.namesItsCharacterSet && (
          <EncodingChoice
            id={`${id}-encoding`}
            value={encoding}
            onChange={(next) => {
              setEncoding(next)
              submission.reset()
            }}
          />
        )}
        {submission.isError && (
          <ManualSubmissionFailure error={submission.error} onRetry={submit} />
        )}
      </div>
      <FormFooter>
        <Button
          // Until the chosen file is read, Upload would send no bytes or the previous file's.
          disabled={
            submission.isPending ||
            channels.isPending ||
            channels.isError ||
            (file !== null && read === null)
          }
          type="submit">
          {submission.isPending && <Spinner aria-hidden data-icon="inline-start" />}
          {submission.isPending ? t('submitting') : t('submit')}
        </Button>
      </FormFooter>
    </form>
  )
}

function CreatedRun({ run }: { run: RunSummary }) {
  const t = useTranslations('ManualSubmission.result')
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
        <Link
          href={documentHref(run.id)}
          className={buttonVariants({ variant: 'outline', size: 'sm' })}>
          {t('open')}
          <span className="sr-only">: {title}</span>
        </Link>
      </ItemActions>
    </Item>
  )
}

function NotRouted({
  notRouted,
  channel,
}: {
  notRouted: ManualSubmission['notRouted']
  channel: Channel
}) {
  const t = useTranslations('ManualSubmission.result.notRouted')

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-dashed p-3">
      <p className="font-medium">{t('title', { count: notRouted.length })}</p>
      <p className="text-muted-foreground">{t('description', { channel: channel.name })}</p>
      <ul className="flex flex-col gap-1">
        {notRouted.map(({ messageType }, index) => {
          const parsed = parseMessageType(messageType)

          return (
            // The same Message Type can occur several times in one Interchange.
            <li key={index}>
              {parsed ? (
                <MessageTypeName messageType={parsed} />
              ) : (
                <span className="font-mono text-xs">{messageType}</span>
              )}
            </li>
          )
        })}
      </ul>
      <NewFlowLink />
    </div>
  )
}

function ManualSubmissionResult({
  submitted,
  onAnother,
}: {
  submitted: Submitted
  onAnother: () => void
}) {
  const t = useTranslations('ManualSubmission.result')
  const id = useId()
  const heading = useRef<HTMLHeadingElement>(null)
  const { submission, fileName, channel } = submitted
  const { runs, notRouted } = submission

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
            {t('description', { fileName, channel: channel.name })}
          </p>
        </div>
        <ul aria-label={t('list')} className="flex flex-col gap-2">
          {runs.map((run) => (
            <CreatedRun key={run.id} run={run} />
          ))}
        </ul>
        {notRouted.length > 0 && <NotRouted channel={channel} notRouted={notRouted} />}
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

export function ManualSubmissionSheet({
  defaultChannelId = null,
  defaultOpen = false,
}: {
  defaultChannelId?: string | null
  defaultOpen?: boolean
}) {
  const t = useTranslations('ManualSubmission')
  const [channelId, setChannelId] = useState(defaultChannelId)
  const [step, setStep] = useState<Step>(firstStep)

  return (
    <Sheet
      defaultOpen={defaultOpen}
      onOpenChangeComplete={(open) => {
        if (!open) {
          setChannelId(defaultChannelId)
          setStep(firstStep)
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
        {step.name === 'result' ? (
          <ManualSubmissionResult
            submitted={step.submitted}
            onAnother={() => setStep({ name: 'form', focusFile: true })}
          />
        ) : (
          <ManualSubmissionForm
            channelId={channelId}
            focusFile={step.focusFile}
            onChannelChange={setChannelId}
            onSubmitted={(submitted) => setStep({ name: 'result', submitted })}
          />
        )}
      </SheetContent>
    </Sheet>
  )
}
