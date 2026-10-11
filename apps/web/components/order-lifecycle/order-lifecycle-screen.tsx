'use client'

import { Route01Icon, Search01Icon, SearchRemoveIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { useId } from 'react'

import { Loading, Notice } from '@/components/detail-parts'
import { LoadError } from '@/components/load-error'
import { OrderLifecycleTimeline } from '@/components/order-lifecycle/order-lifecycle-timeline'
import { orderLifecycleKeys, orderLifecyclesQuery } from '@/lib/api/queries'
import { businessReferenceSchema } from '@edi-bridge/contracts'
import { Button } from '@edi-bridge/ui/components/button'
import { Input } from '@edi-bridge/ui/components/input'

function SearchForm({
  businessReference,
  onSearch,
}: {
  businessReference: string | undefined
  onSearch: (businessReference: string) => void
}) {
  const t = useTranslations('OrderLifecycle.search')
  const inputId = useId()

  return (
    <search>
      <form
        key={businessReference}
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault()

          const parsed = businessReferenceSchema.safeParse(
            new FormData(event.currentTarget).get('businessReference'),
          )

          if (parsed.success) {
            onSearch(parsed.data)
          }
        }}>
        <div className="flex w-full flex-col gap-1.5 sm:w-72">
          <label htmlFor={inputId} className="text-sm font-medium">
            {t('label')}
          </label>
          <Input
            id={inputId}
            autoComplete="off"
            defaultValue={businessReference}
            maxLength={35}
            name="businessReference"
            pattern=".*\S.*"
            required
            title={t('hint')}
            type="search"
          />
        </div>
        <Button type="submit">
          <HugeiconsIcon icon={Search01Icon} strokeWidth={2} aria-hidden />
          {t('submit')}
        </Button>
      </form>
    </search>
  )
}

function Results({ businessReference }: { businessReference: string }) {
  const t = useTranslations('OrderLifecycle')
  const { data, isError, isFetching, refetch } = useQuery(orderLifecyclesQuery(businessReference))

  if (isError) {
    return (
      <LoadError
        description={t('error.description', { businessReference })}
        retryLabel={t('error.retry')}
        title={t('error.title')}
        onRetry={() => void refetch()}
      />
    )
  }

  if (!data) {
    return <Loading label={t('loading', { businessReference })} rowClassName="h-16" rows={4} />
  }

  if (data.length === 0) {
    return (
      <Notice
        description={t('noResult.description', { businessReference })}
        icon={SearchRemoveIcon}
        title={t('noResult.title')}
      />
    )
  }

  return (
    <div aria-busy={isFetching} className="flex flex-col gap-4">
      <p role="status" className="text-muted-foreground text-sm">
        {t('resultCount', { businessReference, count: data.length })}
      </p>
      {data.map((lifecycle) => (
        <OrderLifecycleTimeline key={lifecycle.tradingPartner.id} lifecycle={lifecycle} />
      ))}
    </div>
  )
}

export function OrderLifecycleScreen({
  businessReference,
}: {
  businessReference?: string | undefined
}) {
  const t = useTranslations()
  const router = useRouter()
  const queryClient = useQueryClient()
  const parsed = businessReferenceSchema.safeParse(businessReference)
  const searched = parsed.success ? parsed.data : undefined

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-6 p-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t('Navigation.orderLifecycle')}</h1>
      <SearchForm
        businessReference={searched}
        onSearch={(next) => {
          if (next === searched) {
            void queryClient.invalidateQueries({ queryKey: orderLifecycleKeys.search(next) })
          } else {
            router.push(`/order-lifecycle?${new URLSearchParams({ businessReference: next })}`)
          }
        }}
      />
      {searched === undefined ? (
        <Notice
          description={t('OrderLifecycle.initial.description')}
          icon={Route01Icon}
          title={t('OrderLifecycle.initial.title')}
        />
      ) : (
        <Results key={searched} businessReference={searched} />
      )}
    </div>
  )
}
