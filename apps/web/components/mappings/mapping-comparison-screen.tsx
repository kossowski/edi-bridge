'use client'

import {
  AlertCircleIcon,
  ArrowDataTransferHorizontalIcon,
  CheckmarkCircle02Icon,
  FileNotFoundIcon,
  WorkHistoryIcon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { usePrefetchQuery, useQuery, type UseQueryResult } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { Fragment, type ReactNode, useEffect, useId, useState } from 'react'

import { AppPage } from '@/components/app-page'
import { Failure as FailureNotice, Loading, LoadFailure, Notice } from '@/components/detail-parts'
import { type GraphText, useGraphText } from '@/components/mappings/graph-text'
import { documentSize } from '@/components/mappings/mapping-preview'
import { DocumentText, PreviewNotes } from '@/components/mappings/mapping-preview-panel'
import { useSide } from '@/components/mappings/mapping-side'
import {
  byKind,
  changeCounts,
  type ComparisonRequest,
  comparisonSearch,
  newestFirst,
  outputChange,
  repetitionsOf,
  resolveSample,
  resolveVersions,
  type SampleSelection,
  trailOf,
} from '@/components/mappings/version-comparison'
import { useCanChange } from '@/hooks/use-session'
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@edi-bridge/ui/components/select'
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
  LinkEnd,
  LinkStart,
  LookupTableSummary,
  MappingDifference,
  MappingSample,
  MappingTransform,
  MappingVersion,
  MappingVersionSummary,
  OutputDifference,
  VersionOutput,
} from '@edi-bridge/contracts'

const pageSize = 100

const changeStyles: Record<DifferenceChange, string> = {
  added: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200',
  removed: 'bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200',
  changed: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
}

type VersionSide = {
  source: TreeItem[] | undefined
  target: TreeItem[] | undefined
  text: GraphText
  transforms: ReadonlyArray<MappingTransform>
}

type Sides = { before: VersionSide; after: VersionSide }

type Pair = { from: MappingVersionSummary; to: MappingVersionSummary }

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

  return (
    <FailureNotice
      error={{
        title: t(`${namespace}.error.title`),
        description: t(`${namespace}.error.description`),
        retry: t('retry'),
      }}
      notFound={
        error instanceof ApiError && error.status === 404
          ? { title: t('unknownVersion.title'), description: t('unknownVersion.description') }
          : null
      }
      onRetry={onRetry}
    />
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

function Separated({ text }: { text: string }) {
  return text.split(/(?<=[.›/])/).map((piece, index) => (
    <Fragment key={index}>
      {index > 0 && <wbr />}
      {piece}
    </Fragment>
  ))
}

function PathLabel({ items, path }: { items: TreeItem[] | undefined; path: string }) {
  const trail = items ? trailOf(items, path) : []
  const leaf = trail.at(-1)

  if (!leaf) {
    return (
      <code className="font-mono text-xs wrap-break-word">
        <Separated text={path} />
      </code>
    )
  }

  return (
    <span className="flex flex-col gap-0.5">
      <code title={path} className="font-mono text-xs wrap-break-word">
        <Separated text={trail.map(({ label }) => label).join(' › ')} />
      </code>
      {leaf.name && <span className="text-muted-foreground text-xs">{leaf.name}</span>}
    </span>
  )
}

function StartLabel({ from, side }: { from: LinkStart; side: VersionSide }) {
  return from.kind === 'source' ? (
    <PathLabel items={side.source} path={from.path} />
  ) : (
    <span>{side.text.start(from)}</span>
  )
}

function EndLabel({ to, side }: { to: LinkEnd; side: VersionSide }) {
  return to.kind === 'target' ? (
    <PathLabel items={side.target} path={to.path} />
  ) : (
    <span>{side.text.end(to)}</span>
  )
}

function TransformLabel({ transform, text }: { transform: MappingTransform; text: GraphText }) {
  return (
    <span className="flex flex-col gap-0.5">
      <span className="font-medium">{text.name(transform.id)}</span>
      <span className="text-muted-foreground text-xs wrap-break-word">
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

type DifferenceKind = MappingDifference['kind']

type PartOf<Kind extends DifferenceKind> = NonNullable<
  Extract<MappingDifference, { kind: Kind }>['after']
>

type PartRenderer<Kind extends DifferenceKind> = {
  part: (entry: PartOf<Kind>, side: VersionSide) => ReactNode
  value: (entry: PartOf<Kind>, side: VersionSide) => ReactNode
}

type PartRenderers = { [Kind in DifferenceKind]: PartRenderer<Kind> }

const partRenderers: PartRenderers = {
  link: {
    part: (link, side) => <PathLabel items={side.target} path={link.targetPath} />,
    value: (link, side) => <PathLabel items={side.source} path={link.sourcePath} />,
  },
  transform: {
    part: (transform, side) => <span className="font-medium">{side.text.name(transform.id)}</span>,
    value: (transform, side) => <TransformLabel text={side.text} transform={transform} />,
  },
  transformLink: {
    part: (transformLink, side) => <EndLabel side={side} to={transformLink.to} />,
    value: (transformLink, side) => <StartLabel from={transformLink.from} side={side} />,
  },
}

function differenceCells<Kind extends DifferenceKind>(
  kind: Kind,
  before: PartOf<Kind> | null,
  after: PartOf<Kind> | null,
  sides: Sides,
) {
  const { part, value } = partRenderers[kind]

  return {
    part: after ? part(after, sides.after) : before && part(before, sides.before),
    before: before && value(before, sides.before),
    after: after && value(after, sides.after),
  }
}

function DifferenceRow({ difference, sides }: { difference: MappingDifference; sides: Sides }) {
  const t = useTranslations('MappingComparison.differences')
  const absent = <Absent text={t('absent')} />
  const cells = differenceCells(difference.kind, difference.before, difference.after, sides)

  return (
    <TableRow>
      <TableCell className="align-top">
        <ChangeBadge change={difference.change} />
      </TableCell>
      <TableCell className="align-top whitespace-normal">{cells.part}</TableCell>
      <TableCell className="align-top whitespace-normal">{cells.before ?? absent}</TableCell>
      <TableCell className="align-top whitespace-normal">{cells.after ?? absent}</TableCell>
    </TableRow>
  )
}

function TableRegion({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div
      role="region"
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- keyboard users need a tab stop to scroll a wide table
      tabIndex={0}
      aria-label={label}
      className="focus-visible:ring-ring/50 overflow-x-auto rounded-lg border outline-none focus-visible:ring-3 [&>[data-slot=table-container]]:overflow-visible">
      {children}
    </div>
  )
}

function DifferenceGroup({
  kind,
  differences,
  pair,
  sides,
}: {
  kind: DifferenceKind
  differences: MappingDifference[]
  pair: Pair
  sides: Sides
}) {
  const t = useTranslations('MappingComparison')
  const headingId = useId()
  const { limit, more, showMore } = useLimit(differences.length)

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <h3 id={headingId} className="text-sm font-semibold">
        {t(`differences.kinds.${kind}.title`, { count: differences.length })}
      </h3>
      <TableRegion label={t(`differences.kinds.${kind}.caption`)}>
        <Table className="min-w-xl">
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
              <DifferenceRow key={index} difference={difference} sides={sides} />
            ))}
          </TableBody>
        </Table>
      </TableRegion>
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
  sides,
}: {
  mappingId: string
  pair: Pair
  sides: Sides
}) {
  const t = useTranslations('MappingComparison')

  const comparison = useQuery(
    mappingComparisonQuery(mappingId, { from: pair.from.id, to: pair.to.id }),
  )

  const versions = { from: pair.from.version, to: pair.to.version }

  const content = () => {
    if (comparison.isPending) {
      return <Loading label={t('differences.loading')} rows={4} />
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
                differences={group.differences}
                kind={group.kind}
                pair={pair}
                sides={sides}
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

  if (value === null) {
    return <Absent text={t('notSet')} />
  }

  if (value === '') {
    return <Absent text={t('emptyValue')} />
  }

  return (
    <code className="block max-w-80 font-mono text-xs wrap-break-word whitespace-pre-wrap">
      {value}
    </code>
  )
}

function OutputDifferenceTable({
  differences,
  pair,
  sides,
}: {
  differences: OutputDifference[]
  pair: Pair
  sides: Sides
}) {
  const t = useTranslations('MappingComparison')
  const { limit, more, showMore } = useLimit(differences.length)

  return (
    <div className="flex flex-col gap-2">
      <TableRegion label={t('outputs.caption')}>
        <Table className="min-w-2xl">
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
            {differences.slice(0, limit).map((difference) => {
              const target = (difference.after === null ? sides.before : sides.after).target

              return (
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
              )
            })}
          </TableBody>
        </Table>
      </TableRegion>
      <ShowMore limit={limit} more={more} total={differences.length} onClick={showMore} />
    </div>
  )
}

function OutputDocument({
  label,
  output,
  side,
}: {
  label: string
  output: VersionOutput
  side: VersionSide
}) {
  const tPreview = useTranslations('Mapping.preview')

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h4 className="text-sm font-medium">{label}</h4>
        <span className="text-muted-foreground text-xs">
          {tPreview('size', documentSize(output.document))}
        </span>
      </div>
      <DocumentText document={output.document} label={label} className="max-h-96 min-h-24" />
      <PreviewNotes heading="h5" notes={output.notes} transforms={side.transforms} />
    </div>
  )
}

function SampleOutputs({
  mappingId,
  pair,
  sample,
  sides,
}: {
  mappingId: string
  pair: Pair
  sample: MappingSample
  sides: Sides
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
          <OutputDifferenceTable differences={outputs.differences} pair={pair} sides={sides} />
        </>
      )}
      <section aria-labelledby={documentsId} className="flex flex-col gap-2">
        <h3 id={documentsId} className="text-sm font-semibold">
          {t('outputs.documents')}
        </h3>
        <div className="flex flex-col gap-4 lg:flex-row">
          <OutputDocument
            label={t('outputs.document', { version: pair.from.version })}
            output={outputs.from}
            side={sides.before}
          />
          <OutputDocument
            label={t('outputs.document', { version: pair.to.version })}
            output={outputs.to}
            side={sides.after}
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
  sides,
}: {
  mappingId: string
  pair: Pair
  samples: UseQueryResult<MappingSample[]>
  selection: SampleSelection | undefined
  sides: Sides
}) {
  const t = useTranslations('MappingComparison')

  const content = () => {
    if (samples.isError) {
      return <Failure error={null} namespace="outputs" onRetry={() => void samples.refetch()} />
    }

    switch (selection?.kind) {
      case undefined:
        return <Loading label={t('outputs.loadingSamples')} rows={4} />
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
            sides={sides}
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

function useVersionSide(
  version: MappingVersion,
  lookupTables: ReadonlyArray<LookupTableSummary> | undefined,
): VersionSide {
  const source = useSide(version.source)
  const target = useSide(version.target)
  const text = useGraphText(version.transforms, lookupTables)

  return { source: source.items, target: target.items, text, transforms: version.transforms }
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
  samples: UseQueryResult<MappingSample[]>
  sample: SampleSelection | undefined
}) {
  const lookupTables = useQuery(lookupTablesQuery)

  const sides = {
    before: useVersionSide(before, lookupTables.data),
    after: useVersionSide(after, lookupTables.data),
  }

  return (
    <>
      <MappingDifferences mappingId={mappingId} pair={pair} sides={sides} />
      <OutputDifferences
        mappingId={mappingId}
        pair={pair}
        samples={samples}
        selection={sample}
        sides={sides}
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
  samples: UseQueryResult<MappingSample[]>
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
  const canChange = useCanChange()
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
        description={canChange ? t('tooFew.description') : t('tooFew.viewOnlyDescription')}
        icon={WorkHistoryIcon}
        title={t('tooFew.title')}>
        <Link href={`/mappings/${mappingId}`} className={buttonVariants({ variant: 'outline' })}>
          {t('openDraft')}
        </Link>
      </Notice>
    )
  }

  const ordered = newestFirst(versions.data)
  const latest = ordered[0]?.id

  const versionItems = ordered.map(({ id, version }) => ({
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
          samples={samples}
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
    <AppPage name={data?.name} title={t('title')}>
      {isPending ? (
        <Loading label={t('loading')} rows={6} />
      ) : data ? (
        <Comparison key={comparisonSearch('', initial)} initial={initial} mappingId={id} />
      ) : (
        <LoadFailure
          namespace="Mapping"
          notFound={error instanceof ApiError && error.status === 404}
          onRetry={() => void refetch()}
        />
      )}
    </AppPage>
  )
}
