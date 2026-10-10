'use client'

import { AlertCircleIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { type ReactNode, useEffect, useRef } from 'react'

import { linkClass } from '@/components/detail-parts'
import { MappingList } from '@/components/document-structures/mapping-list'
import { documentStructureProblemOf } from '@/lib/api/client'
import { Button } from '@edi-bridge/ui/components/button'
import { cn } from '@edi-bridge/ui/lib/utils'

import type {
  DocumentStructureProblem,
  DocumentStructureProblemCode,
  DocumentStructureSummary,
} from '@edi-bridge/contracts'

type Mappings = DocumentStructureSummary['mappings']

const detailedCodes = new Set<DocumentStructureProblemCode>([
  'unreadableContent',
  'invalidJson',
  'invalidCsv',
  'invalidJsonSchema',
  'unsupportedJson',
  'unsupportedJsonSchema',
  'inconsistentCsvRows',
  'linkedByMapping',
])

function ProblemAlert({
  problem,
  mappings,
  onShowPath,
}: {
  problem: DocumentStructureProblem
  mappings: Mappings
  onShowPath: ((path: string) => void) | undefined
}) {
  const t = useTranslations('DocumentStructureProblem')
  const { path, line, mappingVersions } = problem

  return (
    <div
      role="alert"
      className="flex w-full gap-3 rounded-lg border border-red-300 bg-red-50 p-4 text-sm dark:border-red-900 dark:bg-red-950/40">
      <HugeiconsIcon
        icon={AlertCircleIcon}
        strokeWidth={2}
        aria-hidden
        className="mt-0.5 size-4 shrink-0 text-red-800 dark:text-red-300"
      />
      <div className="flex min-w-0 flex-col gap-2">
        <p className="font-medium text-red-900 dark:text-red-200">{t(`codes.${problem.code}`)}</p>
        {(line !== null || path !== null) && (
          <p className="flex flex-wrap gap-x-3 gap-y-1">
            {line !== null && <span>{t('line', { line })}</span>}
            {path !== null && (
              <span>
                {t.rich('path', {
                  path,
                  code: (chunks) => <code className="font-mono break-all">{chunks}</code>,
                })}
              </span>
            )}
          </p>
        )}
        {mappingVersions && (
          <div className="flex flex-col gap-1">
            <p>{t('versionsTitle')}</p>
            <ul className="flex flex-col gap-1">
              {mappingVersions.map((version) => (
                <li key={version.id}>
                  <Link href={`/mappings/${version.mappingId}/versions`} className={linkClass}>
                    {t('version', { mappingName: version.mappingName, version: version.version })}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
        {problem.code === 'linkedByMapping' && mappings.length > 0 && (
          <div className="flex flex-col gap-1">
            <p>{t('mappingsTitle')}</p>
            <MappingList mappings={mappings} />
          </div>
        )}
        {detailedCodes.has(problem.code) && (
          <p>
            {t('details')}: <span lang="en">{problem.message}</span>
          </p>
        )}
        {onShowPath && path !== null && (
          <Button
            size="sm"
            variant="outline"
            className="self-start"
            onClick={() => onShowPath(path)}>
            {t('showInTree', { path })}
          </Button>
        )}
      </div>
    </div>
  )
}

export function RefusalAlert({
  error,
  failed,
  mappings = [],
  onShowPath,
  takeFocus = false,
  className,
  children,
}: {
  error: Error | null
  failed: string
  mappings?: Mappings
  onShowPath?: (path: string) => void
  takeFocus?: boolean
  className?: string
  children?: ReactNode
}) {
  const container = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (takeFocus && error) {
      container.current?.focus()
    }
  }, [takeFocus, error])

  if (!error) {
    return null
  }

  const problem = documentStructureProblemOf(error)

  return (
    <div
      ref={container}
      tabIndex={-1}
      className={cn('flex flex-col items-start gap-2 outline-none', className)}>
      {problem ? (
        <ProblemAlert mappings={mappings} problem={problem} onShowPath={onShowPath} />
      ) : (
        <>
          <p role="alert" className="text-sm text-red-800 dark:text-red-300">
            {failed}
          </p>
          {children}
        </>
      )}
    </div>
  )
}
