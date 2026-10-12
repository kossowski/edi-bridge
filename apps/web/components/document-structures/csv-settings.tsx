'use client'

import { useTranslations } from 'next-intl'
import { type ReactNode, useMemo } from 'react'

import { Fact } from '@/components/detail-parts'
import {
  csvColumnNames,
  decodeFirstBytes,
  firstRows,
} from '@/components/document-structures/csv-text'
import { type StructureTree } from '@/components/document-structures/structure-tree'
import {
  characterEncodings,
  type CsvDelimiter,
  csvDelimiters,
  type CsvSettings,
  type EncodedFile,
} from '@edi-bridge/contracts'
import { NativeCheckbox } from '@edi-bridge/ui/components/native-checkbox'
import { NativeSelect, NativeSelectOption } from '@edi-bridge/ui/components/native-select'
import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@edi-bridge/ui/components/table'

export const delimiterKeys = {
  ',': 'comma',
  ';': 'semicolon',
  '\t': 'tab',
  '|': 'pipe',
} as const satisfies Record<CsvDelimiter, string>

const encodingLabels = { 'utf-8': 'UTF-8', 'windows-1252': 'Windows-1252' } as const

function SettingSelect<Value extends string>({
  id,
  label,
  description,
  value,
  values,
  labelOf,
  onChange,
}: {
  id: string
  label: string
  description: string
  value: Value
  values: ReadonlyArray<Value>
  labelOf: (value: Value) => string
  onChange: (value: Value) => void
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <NativeSelect
        id={id}
        value={value}
        aria-describedby={`${id}-description`}
        className="w-full"
        onChange={(event) => {
          const next = values.find((candidate) => candidate === event.target.value)

          if (next !== undefined) {
            onChange(next)
          }
        }}>
        {values.map((candidate) => (
          <NativeSelectOption key={candidate} value={candidate}>
            {labelOf(candidate)}
          </NativeSelectOption>
        ))}
      </NativeSelect>
      <p id={`${id}-description`} className="text-muted-foreground text-sm">
        {description}
      </p>
    </div>
  )
}

export function CsvSettingsFields({
  id,
  csv,
  description,
  onChange,
  children,
}: {
  id: string
  csv: CsvSettings
  description: string
  onChange: (csv: CsvSettings) => void
  children?: ReactNode
}) {
  const t = useTranslations('CsvSettings')

  return (
    <fieldset
      aria-describedby={`${id}-description`}
      className="flex min-w-0 flex-col gap-4 rounded-lg border p-4">
      <legend className="px-1 font-semibold">{t('title')}</legend>
      <p id={`${id}-description`} className="text-muted-foreground text-sm">
        {description}
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <SettingSelect
          id={`${id}-delimiter`}
          description={t('delimiterDescription')}
          label={t('delimiter')}
          labelOf={(delimiter) => t(`delimiters.${delimiterKeys[delimiter]}`)}
          value={csv.delimiter}
          values={csvDelimiters}
          onChange={(delimiter) => onChange({ ...csv, delimiter })}
        />
        <SettingSelect
          id={`${id}-encoding`}
          description={t('encodingDescription')}
          label={t('encoding')}
          labelOf={(encoding) => encodingLabels[encoding]}
          value={csv.encoding}
          values={characterEncodings}
          onChange={(encoding) => onChange({ ...csv, encoding })}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="flex min-h-6 items-center gap-2 text-sm font-medium">
          <NativeCheckbox
            checked={csv.headerRow}
            aria-describedby={`${id}-header-description`}
            onChange={(event) => onChange({ ...csv, headerRow: event.target.checked })}
          />
          {t('headerRow')}
        </label>
        <p id={`${id}-header-description`} className="text-muted-foreground text-sm">
          {t('headerRowDescription')}
        </p>
      </div>
      {children}
    </fieldset>
  )
}

export function CsvSettingsFacts({ id, csv }: { id: string; csv: CsvSettings }) {
  const t = useTranslations('CsvSettings')

  return (
    <section aria-labelledby={id} className="flex min-w-0 flex-col gap-3 rounded-lg border p-4">
      <div className="flex flex-col gap-1">
        <h2 id={id} className="font-semibold">
          {t('title')}
        </h2>
        <p className="text-muted-foreground max-w-prose text-sm">{t('viewOnlyDescription')}</p>
      </div>
      <dl className="grid gap-4 sm:grid-cols-3">
        <Fact label={t('delimiter')}>{t(`delimiters.${delimiterKeys[csv.delimiter]}`)}</Fact>
        <Fact label={t('encoding')}>{encodingLabels[csv.encoding]}</Fact>
        <Fact label={t('headerRowFact')}>
          {csv.headerRow ? t('headerRowPresent') : t('headerRowAbsent')}
        </Fact>
      </dl>
    </section>
  )
}

export function FirstRows({
  file,
  csv,
  tree,
}: {
  file: EncodedFile
  csv: CsvSettings
  tree: StructureTree | null
}) {
  const t = useTranslations('CsvSettings.firstRows')

  const { columns, rows } = useMemo(() => {
    const names = tree && csvColumnNames(tree)

    return { columns: names, rows: firstRows(decodeFirstBytes(file, csv.encoding), csv, names) }
  }, [file, csv, tree])

  const columnCount = Math.max(columns?.length ?? 0, ...rows.map((cells) => cells.length))

  if (columnCount === 0) {
    return null
  }

  const headers = Array.from(
    { length: columnCount },
    (_, index) => columns?.[index] ?? t('column', { number: index + 1 }),
  )

  return (
    <figure className="flex min-w-0 flex-col gap-2">
      <figcaption className="flex flex-col gap-0.5">
        <span className="text-sm font-medium">{t('title')}</span>
        <span className="text-muted-foreground text-sm">
          {t('description', { encoding: encodingLabels[csv.encoding] })}
        </span>
      </figcaption>
      <div
        role="region"
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- keyboard users need a tab stop to scroll wide rows
        tabIndex={0}
        aria-label={t('label', { fileName: file.fileName })}
        className="focus-visible:ring-ring/50 max-h-64 overflow-auto rounded-lg border outline-none focus-visible:ring-3">
        <table className="w-full text-sm">
          <TableHeader>
            <TableRow>
              {headers.map((header, index) => (
                <TableHead key={index} scope="col" className="font-mono text-xs">
                  {header}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columnCount} className="text-muted-foreground">
                  {t('none')}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((cells, row) => (
                <TableRow key={row}>
                  {headers.map((_, column) => (
                    <TableCell key={column} title={cells[column]} className="max-w-56 truncate">
                      {cells[column] ?? ''}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </table>
      </div>
    </figure>
  )
}
