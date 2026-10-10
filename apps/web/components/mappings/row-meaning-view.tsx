'use client'

import { useTranslations } from 'next-intl'

import type { ReactNode } from 'react'

import { kindMeanings, limitCodes, parseFormat } from '@/components/mappings/row-meaning'
import { cn } from '@edi-bridge/ui/lib/utils'

import type { TreeItem } from '@/components/mappings/mapping-tree'

export type MeaningItem = Omit<TreeItem, 'children'>

function Term({ children }: { children: string }) {
  return <dt className="font-medium">{children}</dt>
}

function Value({ children }: { children: ReactNode }) {
  return <dd className="min-w-0 [overflow-wrap:anywhere]">{children}</dd>
}

function FormatText({ format }: { format: string }) {
  const t = useTranslations('Mapping.meaning')
  const parsed = parseFormat(format)

  return (
    <>
      <code className="font-mono">{format}</code>
      {parsed &&
        ` (${t('formatText', {
          characters: parsed.characters,
          variable: parsed.variable ? 'variable' : 'fixed',
          length: parsed.length,
        })})`}
    </>
  )
}

function repetitionText(
  item: MeaningItem,
  t: ReturnType<typeof useTranslations<'Mapping.meaning'>>,
) {
  if (item.repeat === 'unbounded') {
    return t('unbounded')
  }

  return item.repeat === null ? t('once') : t('upTo', { count: item.repeat })
}

export function RowMeaning({
  item,
  codeLimit,
  className,
}: {
  item: MeaningItem
  codeLimit?: number
  className?: string
}) {
  const t = useTranslations('Mapping.meaning')
  const kind = kindMeanings[item.kind]
  const codes = item.edifact?.codes ?? []
  const qualifier = item.edifact?.qualifier
  const { shown, hidden } = limitCodes(codes, codeLimit ?? codes.length)

  return (
    <div className={cn('flex flex-col gap-2 text-xs', className)}>
      <div className="flex flex-col gap-0.5">
        <span>{t(`kind.${item.kind}`)}</span>
        <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
          <code className="font-mono font-semibold">{item.label}</code>
          {item.name && (
            <span className="min-w-0 font-medium [overflow-wrap:anywhere]">{item.name}</span>
          )}
        </p>
      </div>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
        {qualifier && (
          <>
            <Term>{t('qualifier')}</Term>
            <Value>
              <code className="font-mono">{qualifier.code}</code> {qualifier.meaning}
            </Value>
          </>
        )}
        <Term>{t('status')}</Term>
        <Value>{t(item.required ? kind.required : kind.optional)}</Value>
        {kind.repetition && (
          <>
            <Term>{t('repetition')}</Term>
            <Value>{repetitionText(item, t)}</Value>
          </>
        )}
        {item.detail !== null && (
          <>
            <Term>{t(kind.detail)}</Term>
            <Value>
              {kind.detail === 'format' ? (
                <FormatText format={item.detail} />
              ) : (
                <code>{item.detail}</code>
              )}
            </Value>
          </>
        )}
      </dl>
      {shown.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="font-medium">{t('codes')}</p>
          <ul className="flex flex-col gap-0.5">
            {shown.map(({ code, meaning }) => (
              <li key={code} className="[overflow-wrap:anywhere]">
                <code className="font-mono">{code}</code> {meaning}
              </li>
            ))}
          </ul>
          {hidden > 0 && <p>{t('moreCodes', { count: hidden })}</p>}
        </div>
      )}
    </div>
  )
}
