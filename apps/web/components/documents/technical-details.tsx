'use client'

import { useTranslations } from 'next-intl'
import Link from 'next/link'

import { Fact, FactGrid, linkClass, Section } from '@/components/detail-parts'
import { pathStepKeys } from '@/components/documents/document-path'
import { PositionText } from '@/components/documents/error-position'
import { MessageTree } from '@/components/documents/message-tree'
import { RawInterchange } from '@/components/documents/raw-interchange'
import { StepTimings } from '@/components/documents/step-timings'
import { shortId } from '@/components/runs/run-link'
import { documentHref, interchangeHref } from '@/lib/navigation'

import type { RunDetail } from '@edi-bridge/contracts'

function TechnicalFacts({ run }: { run: RunDetail }) {
  const t = useTranslations('Document.technical.facts')
  const tPath = useTranslations('Document.path.step')

  return (
    <FactGrid label={t('label')}>
      <Fact label={t('messageType')}>
        <code className="font-mono text-xs">{run.messageType}</code>
      </Fact>
      <Fact label={t('failedStep')}>
        {run.failureStage === null ? (
          t('noFailure')
        ) : (
          <>
            {tPath(pathStepKeys[run.failureStage])}{' '}
            <code className="text-muted-foreground font-mono text-xs">{run.failureStage}</code>
          </>
        )}
      </Fact>
      {run.error && (
        <>
          <Fact label={t('errorCode')}>
            <code className="font-mono text-xs break-all">{run.error.code}</code>
          </Fact>
          <Fact label={t('position')}>
            {run.error.position ? (
              <span className="font-mono text-xs">
                <PositionText position={run.error.position} />
              </span>
            ) : (
              t('noPosition')
            )}
          </Fact>
          <Fact label={t('errorMessage')}>
            <span className="break-words">{run.error.message}</span>
          </Fact>
        </>
      )}
      <Fact label={t('mappingVersion')}>
        {run.mappingVersion
          ? t('mappingVersionValue', {
              mappingName: run.mappingVersion.mappingName,
              version: run.mappingVersion.version,
            })
          : t('notTranslated')}
      </Fact>
      <Fact label={t('transmission')}>
        {run.interchange ? (
          <Link href={interchangeHref(run.interchange.controlReference)} className={linkClass}>
            {t('transmissionLink', { controlReference: run.interchange.controlReference })}
          </Link>
        ) : (
          t('noTransmission')
        )}
      </Fact>
      {run.replaces && (
        <Fact label={t('replaces')}>
          <Link href={documentHref(run.replaces.id)} className={linkClass}>
            {t('documentLink', { id: shortId(run.replaces.id) })}
          </Link>
        </Fact>
      )}
      {run.replacedBy && (
        <Fact label={t('replacedBy')}>
          <Link href={documentHref(run.replacedBy.id)} className={linkClass}>
            {t('documentLink', { id: shortId(run.replacedBy.id) })}
          </Link>
        </Fact>
      )}
      <Fact label={t('id')}>
        <code className="font-mono text-xs break-all">{run.id}</code>
      </Fact>
    </FactGrid>
  )
}

export function TechnicalDetails({ run }: { run: RunDetail }) {
  const t = useTranslations('Document.technical')

  return (
    <div className="flex flex-col gap-6">
      <TechnicalFacts run={run} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Section id="document-steps" title={t('steps.title')}>
          <StepTimings steps={run.steps} />
        </Section>
        <Section id="document-raw" title={t('raw.title')}>
          {run.interchange ? (
            <RawInterchange position={run.error?.position ?? null} raw={run.interchange.raw} />
          ) : (
            <p className="text-muted-foreground text-sm">{t('raw.none')}</p>
          )}
        </Section>
      </div>
      <Section id="document-tree" title={t('tree.title')}>
        {run.message ? (
          <MessageTree message={run.message} />
        ) : (
          <p className="text-muted-foreground text-sm">
            {run.failureStage === 'parse' ? t('tree.unparsed') : t('tree.none')}
          </p>
        )}
      </Section>
    </div>
  )
}
