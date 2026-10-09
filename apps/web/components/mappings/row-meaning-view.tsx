'use client'

import { useTranslations } from 'next-intl'

import { isEdifactKind, limitCodes, parseFormat } from '@/components/mappings/row-meaning'
import { cn } from '@edi-bridge/ui/lib/utils'

import type { TreeItem } from '@/components/mappings/mapping-tree'

export type MeaningItem = Omit<TreeItem, 'children'>

function Term({ children }: { children: string }) {
  return <dt className="font-medium">{children}</dt>
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
  const edifact = isEdifactKind(item.kind)
  // Composites and elements repeat only with their segment, so their own repetition says nothing.
  const showsRepetition = item.kind !== 'composite' && item.kind !== 'element'
  const { shown, hidden } = limitCodes(item.codes, codeLimit ?? item.codes.length)

  return (
    <div className={cn('flex flex-col gap-2 text-xs', className)}>
      <div className="flex flex-col gap-0.5">
        <span>{t(`kind.${item.kind}`)}</span>
        <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
          <code className="font-mono font-semibold">{item.label}</code>
          {item.name && <span className="font-medium">{item.name}</span>}
        </p>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        {item.qualifier && (
          <>
            <Term>{t('qualifier')}</Term>
            <dd>
              <code className="font-mono">{item.qualifier.code}</code> {item.qualifier.meaning}
            </dd>
          </>
        )}
        <Term>{t('status')}</Term>
        <dd>
          {edifact
            ? t(item.required ? 'mandatory' : 'conditional')
            : t(item.required ? 'required' : 'optional')}
        </dd>
        {showsRepetition && (
          <>
            <Term>{t('repetition')}</Term>
            <dd>{repetitionText(item, t)}</dd>
          </>
        )}
        {item.detail !== null && (
          <>
            <Term>{edifact ? t('format') : t('dataType')}</Term>
            <dd>{edifact ? <FormatText format={item.detail} /> : <code>{item.detail}</code>}</dd>
          </>
        )}
      </dl>
      {shown.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="font-medium">{t('codes')}</p>
          <ul className="flex flex-col gap-0.5">
            {shown.map(({ code, meaning }) => (
              <li key={code}>
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
