'use client'

import { useFormatter, useTranslations } from 'next-intl'
import Link from 'next/link'

import { Fact, FactGrid, linkClass } from '@/components/detail-parts'
import { isTestTransmission } from '@/components/documents/test-transmission-badge'
import { MessageTypeName } from '@/components/plain-names'
import { flowHref, mappingHref, orderHref, tradingPartnerHref } from '@/lib/navigation'

import type { RunDetail } from '@edi-bridge/contracts'

export function DocumentSummary({ run }: { run: RunDetail }) {
  const t = useTranslations('Document.summary')
  const format = useFormatter()
  const reference = run.businessReference
  const values = { direction: run.direction, tradingPartner: run.tradingPartner.name }

  return (
    <FactGrid label={t('label')}>
      <Fact label={t('whatItIs')}>
        <MessageTypeName messageType={run.messageType} />
      </Fact>
      <Fact label={t('order')}>
        {reference === null ? (
          t('noOrder')
        ) : (
          <Link href={orderHref(reference)} className={linkClass}>
            {reference}
          </Link>
        )}
      </Fact>
      <Fact label={t('tradingPartner')}>
        <Link href={tradingPartnerHref(run.tradingPartner.id)} className={linkClass}>
          {run.tradingPartner.name}
        </Link>
      </Fact>
      <Fact label={t('direction')}>{t('directionValue', values)}</Fact>
      <Fact label={t('mapping')}>
        {run.mappingVersion ? (
          <>
            <Link href={mappingHref(run.mappingVersion.mappingId)} className={linkClass}>
              {run.mappingVersion.mappingName}
            </Link>{' '}
            <span className="text-muted-foreground">
              {t('mappingVersion', { version: run.mappingVersion.version })}
            </span>
          </>
        ) : (
          t('notTranslated')
        )}
      </Fact>
      <Fact label={t('route')}>
        <Link href={flowHref(run.flow.id)} className={linkClass}>
          {run.flow.name}
        </Link>
      </Fact>
      <Fact label={t('receivedAt', values)}>
        <time dateTime={run.receivedAt}>
          {format.dateTime(new Date(run.receivedAt), { dateStyle: 'medium', timeStyle: 'medium' })}
        </time>
      </Fact>
      <Fact label={t('source')}>{run.manualSubmission ? t('uploaded') : t('connection')}</Fact>
      {isTestTransmission(run) && (
        <Fact label={t('interchange')}>{t('testInterchange', values)}</Fact>
      )}
    </FactGrid>
  )
}
