'use client'

import { useQueries, useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { type ReactNode, useId } from 'react'

import { usePlainNames } from '@/components/plain-names'
import { PartnerGln } from '@/components/trading-partners/partner-gln'
import {
  type PlanChannel,
  type PlannedRoute,
  type SetupPlan,
  setupPlan,
} from '@/components/trading-partners/partner-setup-plan'
import {
  WizardLoadFailed,
  WizardLoading,
} from '@/components/trading-partners/partner-wizard-load-state'
import { type WizardResult } from '@/components/trading-partners/partner-wizard-state'
import { TestModeBadge } from '@/components/trading-partners/test-mode-badge'
import { channelsQuery, publishedMappingVersionsQuery } from '@/lib/api/queries'
import { directionOf } from '@edi-bridge/contracts'

function PlanSection({ title, children }: { title: string; children: ReactNode }) {
  const id = useId()

  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <h3 id={id} className="text-sm font-medium">
        {title}
      </h3>
      {children}
    </section>
  )
}

function PlanItem({ title, detail }: { title: ReactNode; detail?: ReactNode }) {
  return (
    <li className="flex flex-col gap-0.5 rounded-lg border p-3 text-sm">
      <span className="font-medium">{title}</span>
      {detail && <span className="text-muted-foreground">{detail}</span>}
    </li>
  )
}

function routeEnds(route: PlannedRoute<PlanChannel>) {
  const partner = route.partnerConnection.values.name

  return route.direction === 'inbound'
    ? { from: partner, to: route.ownChannel.name }
    : { from: route.ownChannel.name, to: partner }
}

export type SetupPlanState =
  | { status: 'loading' }
  | { status: 'failed'; retry: () => void }
  | { status: 'ready'; plan: SetupPlan<PlanChannel> }

export function useSetupPlan(result: WizardResult, active: boolean): SetupPlanState {
  const tSuggested = useTranslations('TradingPartner.addConnection.suggestedName')
  const tRoute = useTranslations('TradingPartner.addDocument.routeName')
  const plainNames = usePlainNames()
  const name = result.partner.name
  const channels = useQuery({ ...channelsQuery, enabled: active })

  const versions = useQueries({
    queries: result.documents.flatMap((document) =>
      result.mappings[document]?.way === 'existing'
        ? [{ ...publishedMappingVersionsQuery(document), enabled: active }]
        : [],
    ),
  })

  const queries = [channels, ...versions]

  if (queries.some((query) => query.isError)) {
    return {
      status: 'failed',
      retry: () => {
        for (const query of queries) {
          if (query.isError) {
            void query.refetch()
          }
        }
      },
    }
  }

  if (channels.data === undefined || versions.some((query) => query.data === undefined)) {
    return { status: 'loading' }
  }

  return {
    status: 'ready',
    plan: setupPlan(result, {
      channels: channels.data,
      mappingVersions: versions.flatMap((query) => query.data ?? []),
      names: {
        connection: (kind) => tSuggested(kind, { name }),
        route: (messageType) =>
          tRoute(directionOf({ messageType }), {
            document: plainNames.messageTypeName(messageType, true),
            name,
          }),
      },
    }),
  }
}

export function ReviewStep({ state }: { state: SetupPlanState }) {
  const t = useTranslations('PartnerWizard.review')
  const tWizard = useTranslations('PartnerWizard')
  const tHow = useTranslations('TradingPartner.addConnection.how')

  if (state.status === 'failed') {
    return <WizardLoadFailed message={t('failed')} onRetry={state.retry} />
  }

  if (state.status === 'loading') {
    return <WizardLoading message={t('loading')} />
  }

  const { plan } = state
  const { name } = plan.partner

  return (
    <div className="flex flex-col gap-6">
      <PlanSection title={t('partner.title')}>
        <ul className="flex flex-col gap-2">
          <PlanItem
            detail={<PartnerGln gln={plan.partner.gln} label="prefix" />}
            title={
              <span className="flex flex-wrap items-center gap-2">
                {name}
                <TestModeBadge testMode />
              </span>
            }
          />
        </ul>
      </PlanSection>

      <PlanSection title={t('connections.title')}>
        {plan.connections.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t('connections.none')}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {plan.connections.map((connection) => (
              <PlanItem
                key={connection.direction}
                detail={tHow(`${connection.kind}.title`, { name })}
                title={connection.values.name}
              />
            ))}
          </ul>
        )}
      </PlanSection>

      {plan.mappingDrafts.length > 0 && (
        <PlanSection title={t('mappings.title')}>
          <ul className="flex flex-col gap-2">
            {plan.mappingDrafts.map((messageType) => (
              <PlanItem
                key={messageType}
                detail={t('mappings.detail')}
                title={t('mappings.draft', {
                  documents: tWizard(`documentNames.${messageType}`),
                })}
              />
            ))}
          </ul>
        </PlanSection>
      )}

      <PlanSection title={t('routes.title')}>
        <ul className="flex flex-col gap-2">
          {plan.documents.map((document) => {
            const documents = tWizard(`documentNames.${document.messageType}`)

            if ('route' in document) {
              return (
                <PlanItem
                  key={document.messageType}
                  detail={t('routes.detail', {
                    ...routeEnds(document.route),
                    mapping: document.route.mappingVersion.mappingName,
                    version: document.route.mappingVersion.version,
                  })}
                  title={document.route.name}
                />
              )
            }

            return (
              <PlanItem
                key={document.messageType}
                detail={document.reasons
                  .map((reason) => t(`routes.reasons.${reason}`, { name, documents }))
                  .join(' ')}
                title={t('routes.left', { documents })}
              />
            )
          })}
        </ul>
      </PlanSection>

      <div className="bg-muted/50 flex flex-col gap-2 rounded-lg p-4 text-sm">
        <p className="flex flex-wrap items-center gap-2 font-medium">
          {t('testing.title')}
          <TestModeBadge testMode />
        </p>
        <p className="text-muted-foreground">{t('testing.description', { name })}</p>
      </div>
    </div>
  )
}
