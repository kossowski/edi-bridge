'use client'

import {
  AlertCircleIcon,
  ArrowDataTransferHorizontalIcon,
  CheckmarkCircle02Icon,
  FileNotFoundIcon,
  WorkHistoryIcon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react'
import { usePrefetchQuery, useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { type ReactNode, useEffect, useId, useState } from 'react'

import { LoadFailure } from '@/components/detail-parts'
import { ListScreen } from '@/components/list-screen'
import { type GraphText, useGraphText } from '@/components/mappings/graph-text'
import { useSide } from '@/components/mappings/mapping-canvas-screen'
import { documentText, lineCount } from '@/components/mappings/mapping-preview'
import {
  byKind,
  changeCounts,
  type ComparisonRequest,
  comparisonSearch,
  outputChange,
  repetitionsOf,
  resolveSample,
  resolveVersions,
  type SampleSelection,
  trailOf,
} from '@/components/mappings/version-comparison'
import { ApiError } from '@/lib/api/client'
import {
  lookupTablesQuery,
  mappingComparisonQuery,
  mappingDraftQuery,
  mappingSamplesQuery,
  mappingVersionQuery,
  mappingVersionsQuery,
} from '@/lib/api/queries'
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@edi-bridge/ui/components/select'
import { Skeleton } from '@edi-bridge/ui/components/skeleton'
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@edi-bridge/ui/components/table'
import { cn } from '@edi-bridge/ui/lib/utils'

import type { TreeItem } from '@/components/mappings/mapping-tree'
import type {
  DifferenceChange,
  DocumentContent,
  LinkEnd,
  LinkStart,
  MappingDifference,
  MappingSample,
  MappingTransform,
  MappingVersion,
  MappingVersionSummary,
  OutputDifference,
} from '@edi-bridge/contracts'

const pageSize = 100

const formats = { json: 'JSON', edifact: 'EDIFACT' } as const

const changeStyles: Record<DifferenceChange, string> = {
  added: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200',
  removed: 'bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200',
  changed: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
}

type Trees = { source: TreeItem[] | undefined; target: TreeItem[] | undefined }

type Pair = { from: MappingVersionSummary; to: MappingVersionSummary }

function Loading({ label, rows = 4 }: { label: string; rows?: number }) {
  return (
    <div aria-busy className="flex flex-col gap-2">
      <p role="status" className="sr-only">
        {label}
      </p>
      {Array.from({ length: rows }, (_, row) => (
        <Skeleton key={row} className="h-8 w-full" />
      ))}
    </div>
  )
}

function Notice({
  icon,
  title,
  description,
  children,
}: {
  icon: IconSvgElement
  title: string
  description: string
  children?: ReactNode
}) {
  return (
    <Empty className="border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <HugeiconsIcon icon={icon} strokeWidth={2} />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      {children && <EmptyContent>{children}</EmptyContent>}
    </Empty>
  )
}

function Failure({
  namespace,
  error,
  onRetry,
}: {
  namespace: 'differences' | 'outputs' | 'versions'
  error: Error | null
  onRetry: () => void
}) {
  const t = useTranslations('MappingComparison')

  if (error instanceof ApiError && error.status === 404) {
    return (
      <Notice
        description={t('unknownVersion.description')}
        icon={FileNotFoundIcon}
        title={t('unknownVersion.title')}
      />
    )
  }

  return (
    <Notice
      description={t(`${namespace}.error.description`)}
      icon={AlertCircleIcon}
      title={t(`${namespace}.error.title`)}>
      <Button variant="outline" onClick={onRetry}>
        {t('retry')}
      </Button>
    </Notice>
  )
}

function ChangeBadge({ change }: { change: DifferenceChange }) {
  const t = useTranslations('MappingComparison.change')

  return (
    <span
      className={cn(
        'inline-flex h-5 items-center rounded-4xl px-2 text-xs font-medium whitespace-nowrap',
        changeStyles[change],
      )}>
      {t(change)}
    </span>
  )
}

function Absent({ text }: { text: string }) {
  return <span className="text-muted-foreground italic">{text}</span>
}

function PathLabel({ items, path }: { items: TreeItem[] | undefined; path: string }) {
  const trail = items ? trailOf(items, path) : []
  const leaf = trail.at(-1)

  if (!leaf) {
    return <code className="font-mono text-xs [overflow-wrap:anywhere]">{path}</code>
  }

  return (
    <span className="flex flex-col gap-0.5">
      <code title={path} className="font-mono text-xs [overflow-wrap:anywhere]">
        {trail.map(({ label }) => label).join(' › ')}
      </code>
      {leaf.name && <span className="text-muted-foreground text-xs">{leaf.name}</span>}
    </span>
  )
}

function StartLabel({ from, trees, text }: { from: LinkStart; trees: Trees; text: GraphText }) {
  return from.kind === 'source' ? (
    <PathLabel items={trees.source} path={from.path} />
  ) : (
    <span>{text.start(from)}</span>
  )
}

function EndLabel({ to, trees, text }: { to: LinkEnd; trees: Trees; text: GraphText }) {
  return to.kind === 'target' ? (
    <PathLabel items={trees.target} path={to.path} />
  ) : (
    <span>{text.end(to)}</span>
  )
}

function TransformLabel({ transform, text }: { transform: MappingTransform; text: GraphText }) {
  return (
    <span className="flex flex-col gap-0.5">
      <span className="font-medium">{text.name(transform.id)}</span>
      <span className="text-muted-foreground text-xs [overflow-wrap:anywhere]">
        {text.summary(transform)}
      </span>
    </span>
  )
}

function useLimit(total: number) {
  const [limit, setLimit] = useState(pageSize)

  return {
    limit,
    more: Math.min(total - limit, pageSize),
    showMore: () => setLimit(limit + pageSize),
  }
}

function ShowMore({
  total,
  limit,
  more,
  onClick,
}: {
  total: number
  limit: number
  more: number
  onClick: () => void
}) {
  const t = useTranslations('MappingComparison')

  if (more <= 0) {
    return null
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <p className="text-muted-foreground text-sm">{t('shown', { shown: limit, total })}</p>
      <Button size="sm" variant="outline" onClick={onClick}>
        {t('showMore', { count: more })}
      </Button>
    </div>
  )
}

function DifferenceRow({
  difference,
  trees,
  before,
  after,
}: {
  difference: MappingDifference
  trees: Trees
  before: GraphText
  after: GraphText
}) {
  const t = useTranslations('MappingComparison.differences')
  const absent = <Absent text={t('absent')} />

  const cells = (() => {
    switch (difference.kind) {
      case 'link': {
        const target = (difference.after ?? difference.before)!.targetPath

        return {
          part: <PathLabel items={trees.target} path={target} />,
          before: difference.before ? (
            <PathLabel items={trees.source} path={difference.before.sourcePath} />
          ) : (
            absent
          ),
          after: difference.after ? (
            <PathLabel items={trees.source} path={difference.after.sourcePath} />
          ) : (
            absent
          ),
        }
      }

      case 'transform':
        return {
          part: (
            <span className="font-medium">
              {difference.after
                ? after.name(difference.after.id)
                : before.name(difference.before!.id)}
            </span>
          ),
          before: difference.before ? (
            <TransformLabel text={before} transform={difference.before} />
          ) : (
            absent
          ),
          after: difference.after ? (
            <TransformLabel text={after} transform={difference.after} />
          ) : (
            absent
          ),
        }

      case 'transformLink':
        return {
          part: difference.after ? (
            <EndLabel text={after} to={difference.after.to} trees={trees} />
          ) : (
            <EndLabel text={before} to={difference.before!.to} trees={trees} />
          ),
          before: difference.before ? (
            <StartLabel from={difference.before.from} text={before} trees={trees} />
          ) : (
            absent
          ),
          after: difference.after ? (
            <StartLabel from={difference.after.from} text={after} trees={trees} />
          ) : (
            absent
          ),
        }
    }
  })()

  return (
    <TableRow>
      <TableCell className="align-top">
        <ChangeBadge change={difference.change} />
      </TableCell>
      <TableCell className="align-top whitespace-normal">{cells.part}</TableCell>
      <TableCell className="align-top whitespace-normal">{cells.before}</TableCell>
      <TableCell className="align-top whitespace-normal">{cells.after}</TableCell>
    </TableRow>
  )
}

function DifferenceGroup({
  kind,
  differences,
  pair,
  trees,
  before,
  after,
}: {
  kind: MappingDifference['kind']
  differences: MappingDifference[]
  pair: Pair
  trees: Trees
  before: GraphText
  after: GraphText
}) {
  const t = useTranslations('MappingComparison')
  const headingId = useId()
  const { limit, more, showMore } = useLimit(differences.length)

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <h3 id={headingId} className="text-sm font-semibold">
        {t(`differences.kinds.${kind}.title`, { count: differences.length })}
      </h3>
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableCaption className="sr-only">{t(`differences.kinds.${kind}.caption`)}</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col" className="w-28">
                {t('columns.change')}
              </TableHead>
              <TableHead scope="col">{t(`differences.kinds.${kind}.part`)}</TableHead>
              <TableHead scope="col">{t('version', { version: pair.from.version })}</TableHead>
              <TableHead scope="col">{t('version', { version: pair.to.version })}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {differences.slice(0, limit).map((difference, index) => (
              <DifferenceRow
                key={index}
                after={after}
                before={before}
                difference={difference}
                trees={trees}
              />
            ))}
          </TableBody>
        </Table>
      </div>
      <ShowMore limit={limit} more={more} total={differences.length} onClick={showMore} />
    </section>
  )
}

function SectionShell({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: ReactNode
}) {
  const headingId = useId()

  return (
    <section aria-labelledby={headingId} className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 id={headingId} className="font-semibold">
          {title}
        </h2>
        <p className="text-muted-foreground text-sm">{description}</p>
      </div>
      {children}
    </section>
  )
}

function MappingDifferences({
  mappingId,
  pair,
  trees,
  before,
  after,
}: {
  mappingId: string
  pair: Pair
  trees: Trees
  before: GraphText
  after: GraphText
}) {
  const t = useTranslations('MappingComparison')

  const comparison = useQuery(
    mappingComparisonQuery(mappingId, { from: pair.from.id, to: pair.to.id }),
  )

  const versions = { from: pair.from.version, to: pair.to.version }

  const content = () => {
    if (comparison.isPending) {
      return <Loading label={t('differences.loading')} />
    }

    if (comparison.isError) {
      return (
        <Failure
          error={comparison.error}
          namespace="differences"
          onRetry={() => void comparison.refetch()}
        />
      )
    }

    const { differences } = comparison.data

    if (differences.length === 0) {
      return (
        <Notice
          description={t('differences.empty.description', versions)}
          icon={CheckmarkCircle02Icon}
          title={t('differences.empty.title')}
        />
      )
    }

    return (
      <>
        <p className="text-sm">
          {t('differences.summary', { count: differences.length, ...changeCounts(differences) })}
        </p>
        {byKind(differences).map(
          (group) =>
            group.differences.length > 0 && (
              <DifferenceGroup
                key={group.kind}
                after={after}
                before={before}
                differences={group.differences}
                kind={group.kind}
                pair={pair}
                trees={trees}
              />
            ),
        )}
      </>
    )
  }

  return (
    <SectionShell
      description={t('differences.description', versions)}
      title={t('differences.title')}>
      {content()}
    </SectionShell>
  )
}

function Repetitions({
  items,
  difference,
}: {
  items: TreeItem[] | undefined
  difference: OutputDifference
}) {
  const t = useTranslations('MappingComparison.outputs')

  if (difference.repetitions.length === 0) {
    return <Absent text={t('single')} />
  }

  const trail = items ? trailOf(items, difference.path) : []

  return (
    <span>
      {repetitionsOf(trail, difference.repetitions)
        .map(({ label, number }) =>
          label === null ? t('repetitionPlain', { number }) : t('repetition', { label, number }),
        )
        .join(', ')}
    </span>
  )
}

function OutputValue({ value }: { value: string | null }) {
  const t = useTranslations('MappingComparison.outputs')

  return value === null ? (
    <Absent text={t('notSet')} />
  ) : (
    <code className="font-mono text-xs [overflow-wrap:anywhere] whitespace-pre-wrap">{value}</code>
  )
}

function OutputDifferenceTable({
  differences,
  pair,
  target,
}: {
  differences: OutputDifference[]
  pair: Pair
  target: TreeItem[] | undefined
}) {
  const t = useTranslations('MappingComparison')
  const { limit, more, showMore } = useLimit(differences.length)

  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableCaption className="sr-only">{t('outputs.caption')}</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col" className="w-28">
                {t('columns.change')}
              </TableHead>
              <TableHead scope="col">{t('outputs.columns.path')}</TableHead>
              <TableHead scope="col">{t('outputs.columns.repetition')}</TableHead>
              <TableHead scope="col">{t('version', { version: pair.from.version })}</TableHead>
              <TableHead scope="col">{t('version', { version: pair.to.version })}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {differences.slice(0, limit).map((difference) => (
              <TableRow key={`${difference.path}|${difference.repetitions.join('/')}`}>
                <TableCell className="align-top">
                  <ChangeBadge change={outputChange(difference.before, difference.after)} />
                </TableCell>
                <TableCell className="align-top whitespace-normal">
                  <PathLabel items={target} path={difference.path} />
                </TableCell>
                <TableCell className="align-top text-xs whitespace-normal">
                  <Repetitions difference={difference} items={target} />
                </TableCell>
                <TableCell className="align-top whitespace-normal">
                  <OutputValue value={difference.before} />
                </TableCell>
                <TableCell className="align-top whitespace-normal">
                  <OutputValue value={difference.after} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <ShowMore limit={limit} more={more} total={differences.length} onClick={showMore} />
    </div>
  )
}

function OutputDocument({ label, document }: { label: string; document: DocumentContent }) {
  const tPreview = useTranslations('Mapping.preview')
  const text = documentText(document)
  const headingId = useId()

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h4 id={headingId} className="text-sm font-medium">
          {label}
        </h4>
        <span className="text-muted-foreground text-xs">
          {tPreview('size', { format: formats[document.format], count: lineCount(text) })}
        </span>
      </div>
      <pre
        role="region"
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- keyboard users need a tab stop to scroll a long Document
        tabIndex={0}
        aria-labelledby={headingId}
        className="bg-muted/40 focus-visible:ring-ring/50 max-h-96 min-h-24 overflow-auto rounded-md border p-3 font-mono text-xs leading-5 outline-none focus-visible:ring-3">
        {text}
      </pre>
    </div>
  )
}

function SampleOutputs({
  mappingId,
  pair,
  sample,
  target,
}: {
  mappingId: string
  pair: Pair
  sample: MappingSample
  target: TreeItem[] | undefined
}) {
  const t = useTranslations('MappingComparison')
  const documentsId = useId()

  const comparison = useQuery(
    mappingComparisonQuery(mappingId, {
      from: pair.from.id,
      to: pair.to.id,
      sampleId: sample.id,
    }),
  )

  if (comparison.isPending) {
    return <Loading label={t('outputs.loading', { name: sample.name })} rows={6} />
  }

  if (comparison.isError || !comparison.data.outputs) {
    return (
      <Failure
        error={comparison.error}
        namespace="outputs"
        onRetry={() => void comparison.refetch()}
      />
    )
  }

  const outputs = comparison.data.outputs
  const versions = { from: pair.from.version, to: pair.to.version, name: sample.name }

  return (
    <>
      {outputs.differences.length === 0 ? (
        <Notice
          description={t('outputs.empty.description', versions)}
          icon={CheckmarkCircle02Icon}
          title={t('outputs.empty.title')}
        />
      ) : (
        <>
          <p className="text-sm">
            {t('outputs.summary', { count: outputs.differences.length, name: sample.name })}
          </p>
          <OutputDifferenceTable differences={outputs.differences} pair={pair} target={target} />
        </>
      )}
      <section aria-labelledby={documentsId} className="flex flex-col gap-2">
        <h3 id={documentsId} className="text-sm font-semibold">
          {t('outputs.documents')}
        </h3>
        <div className="flex flex-col gap-4 lg:flex-row">
          <OutputDocument
            document={outputs.from.document}
            label={t('outputs.document', { version: pair.from.version })}
          />
          <OutputDocument
            document={outputs.to.document}
            label={t('outputs.document', { version: pair.to.version })}
          />
        </div>
      </section>
    </>
  )
}

function OutputDifferences({
  mappingId,
  pair,
  samples,
  selection,
  target,
}: {
  mappingId: string
  pair: Pair
  samples: { isError: boolean; refetch: () => void }
  selection: SampleSelection | undefined
  target: TreeItem[] | undefined
}) {
  const t = useTranslations('MappingComparison')

  const content = () => {
    if (samples.isError) {
      return <Failure error={null} namespace="outputs" onRetry={samples.refetch} />
    }

    switch (selection?.kind) {
      case undefined:
        return <Loading label={t('outputs.loadingSamples')} />
      case 'none':
        return (
          <Notice
            description={t('outputs.noSamples.description')}
            icon={WorkHistoryIcon}
            title={t('outputs.noSamples.title')}
          />
        )
      case 'unknown':
        return (
          <Notice
            description={t('outputs.unknownSample.description')}
            icon={FileNotFoundIcon}
            title={t('outputs.unknownSample.title')}
          />
        )
      case 'ready':
        return (
          <SampleOutputs
            key={selection.sample.id}
            mappingId={mappingId}
            pair={pair}
            sample={selection.sample}
            target={target}
          />
        )
    }
  }

  return (
    <SectionShell description={t('outputs.description')} title={t('outputs.title')}>
      {content()}
    </SectionShell>
  )
}

function ComparedVersions({
  mappingId,
  pair,
  before,
  after,
  samples,
  sample,
}: {
  mappingId: string
  pair: Pair
  before: MappingVersion
  after: MappingVersion
  samples: { isError: boolean; refetch: () => void }
  sample: SampleSelection | undefined
}) {
  const source = useSide(after.source)
  const target = useSide(after.target)
  const lookupTables = useQuery(lookupTablesQuery)
  const beforeText = useGraphText(before.transforms, lookupTables.data)
  const afterText = useGraphText(after.transforms, lookupTables.data)
  const trees = { source: source.items, target: target.items }

  return (
    <>
      <MappingDifferences
        after={afterText}
        before={beforeText}
        mappingId={mappingId}
        pair={pair}
        trees={trees}
      />
      <OutputDifferences
        mappingId={mappingId}
        pair={pair}
        samples={samples}
        selection={sample}
        target={trees.target}
      />
    </>
  )
}

function VersionGraphs({
  mappingId,
  pair,
  samples,
  sample,
}: {
  mappingId: string
  pair: Pair
  samples: { isError: boolean; refetch: () => void }
  sample: SampleSelection | undefined
}) {
  const t = useTranslations('MappingComparison')
  const before = useQuery(mappingVersionQuery(mappingId, pair.from.id))
  const after = useQuery(mappingVersionQuery(mappingId, pair.to.id))

  // The comparison does not need the graphs, so it loads alongside them.
  usePrefetchQuery(mappingComparisonQuery(mappingId, { from: pair.from.id, to: pair.to.id }))

  if (before.isError || after.isError) {
    return (
      <Failure
        error={before.error ?? after.error}
        namespace="differences"
        onRetry={() => {
          void (before.isError && before.refetch())
          void (after.isError && after.refetch())
        }}
      />
    )
  }

  if (!before.data || !after.data) {
    return <Loading label={t('differences.loading')} rows={6} />
  }

  return (
    <ComparedVersions
      after={after.data}
      before={before.data}
      mappingId={mappingId}
      pair={pair}
      sample={sample}
      samples={samples}
    />
  )
}

function Choice({
  label,
  value,
  items,
  placeholder,
  onChange,
}: {
  label: string
  value: string | null
  items: ReadonlyArray<{ value: string; label: string }>
  placeholder: string
  onChange: (value: string) => void
}) {
  const labelId = useId()

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span id={labelId} className="text-sm font-medium">
        {label}
      </span>
      <Select items={items} value={value} onValueChange={(next) => next && onChange(next)}>
        <SelectTrigger aria-labelledby={labelId} className="w-56 max-w-full">
          <SelectValue className="min-w-0">
            {(chosen: string | null) => (
              <span className="truncate">
                {items.find((item) => item.value === chosen)?.label ?? placeholder}
              </span>
            )}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

function InvalidSelection({ same }: { same: boolean }) {
  const t = useTranslations('MappingComparison')
  const reason = same ? 'sameVersion' : 'unknownVersion'

  return (
    <Notice
      description={t(`${reason}.description`)}
      icon={same ? AlertCircleIcon : FileNotFoundIcon}
      title={t(`${reason}.title`)}
    />
  )
}

function Comparison({ mappingId, initial }: { mappingId: string; initial: ComparisonRequest }) {
  const t = useTranslations('MappingComparison')
  const [request, setRequest] = useState(initial)
  const versions = useQuery(mappingVersionsQuery(mappingId))
  const samples = useQuery(mappingSamplesQuery(mappingId))
  const selection = versions.data ? resolveVersions(versions.data, request) : undefined
  const sample = samples.data ? resolveSample(samples.data, request.sample) : undefined

  const chosen: ComparisonRequest =
    selection?.kind === 'ready'
      ? {
          from: selection.from.id,
          to: selection.to.id,
          sample: sample?.kind === 'ready' ? sample.sample.id : request.sample,
        }
      : request

  const shared = selection !== undefined && selection.kind !== 'tooFew'
  const { from, to, sample: sampleId } = chosen

  useEffect(() => {
    if (!shared) {
      return
    }

    const search = comparisonSearch(window.location.search, { from, to, sample: sampleId })

    if (search !== window.location.search) {
      window.history.replaceState(null, '', `${window.location.pathname}${search}`)
    }
  }, [shared, from, to, sampleId])

  if (versions.isPending) {
    return <Loading label={t('loading')} rows={6} />
  }

  if (versions.isError) {
    return <Failure error={null} namespace="versions" onRetry={() => void versions.refetch()} />
  }

  if (selection?.kind === 'tooFew') {
    return (
      <Notice
        description={t('tooFew.description')}
        icon={WorkHistoryIcon}
        title={t('tooFew.title')}>
        <Link href={`/mappings/${mappingId}`} className={buttonVariants({ variant: 'outline' })}>
          {t('openDraft')}
        </Link>
      </Notice>
    )
  }

  const latest = versions.data[0]?.id

  const versionItems = versions.data.map(({ id, version }) => ({
    value: id,
    label: id === latest ? t('latestVersion', { version }) : t('version', { version }),
  }))

  const sampleItems = (samples.data ?? []).map(({ id, name }) => ({ value: id, label: name }))
  const choose = (change: ComparisonRequest) => setRequest({ ...chosen, ...change })

  const knownValue = (id: string | undefined) =>
    versionItems.some(({ value }) => value === id) ? id! : null

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end gap-3 rounded-lg border p-4">
        <Choice
          items={versionItems}
          label={t('from')}
          placeholder={t('chooseVersion')}
          value={knownValue(chosen.from)}
          onChange={(from) => choose({ from })}
        />
        <Button
          disabled={chosen.from === undefined || chosen.to === undefined}
          variant="ghost"
          onClick={() => choose({ from: chosen.to, to: chosen.from })}>
          <HugeiconsIcon icon={ArrowDataTransferHorizontalIcon} strokeWidth={2} aria-hidden />
          {t('swap')}
        </Button>
        <Choice
          items={versionItems}
          label={t('to')}
          placeholder={t('chooseVersion')}
          value={knownValue(chosen.to)}
          onChange={(to) => choose({ to })}
        />
        {sampleItems.length > 0 && (
          <Choice
            items={sampleItems}
            label={t('sample')}
            placeholder={t('chooseSample')}
            value={sample?.kind === 'ready' ? sample.sample.id : null}
            onChange={(next) => choose({ sample: next })}
          />
        )}
      </div>
      {selection?.kind === 'ready' ? (
        <VersionGraphs
          key={`${selection.from.id}|${selection.to.id}`}
          mappingId={mappingId}
          pair={selection}
          sample={sample}
          samples={{ isError: samples.isError, refetch: () => void samples.refetch() }}
        />
      ) : (
        <InvalidSelection same={selection?.kind === 'sameVersion'} />
      )}
    </div>
  )
}

export function MappingComparisonScreen({ id, ...initial }: { id: string } & ComparisonRequest) {
  const t = useTranslations('MappingComparison')
  const { data, error, isPending, refetch } = useQuery(mappingDraftQuery(id))

  return (
    <ListScreen
      back={{ href: `/mappings/${id}/versions`, label: t('back') }}
      subtitle={data?.name}
      title={t('title')}>
      {isPending ? (
        <Loading label={t('loading')} rows={6} />
      ) : data ? (
        <Comparison initial={initial} mappingId={id} />
      ) : (
        <LoadFailure
          namespace="Mapping"
          notFound={error instanceof ApiError && error.status === 404}
          onRetry={() => void refetch()}
        />
      )}
    </ListScreen>
  )
}
