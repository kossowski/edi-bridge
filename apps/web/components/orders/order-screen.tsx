'use client'

import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import Link from 'next/link'

import { AppPage } from '@/components/app-page'
import { Loading } from '@/components/detail-parts'
import { LoadError } from '@/components/load-error'
import { NotFoundMessage } from '@/components/not-found-message'
import { OrderTimeline } from '@/components/orders/order-timeline'
import { useBreadcrumbName } from '@/hooks/use-breadcrumb-name'
import { orderLifecycleDetailQuery } from '@/lib/api/queries'
import { sidebarItem } from '@/lib/navigation'
import { businessReferenceSchema } from '@edi-bridge/contracts'
import { buttonVariants } from '@edi-bridge/ui/components/button'

function OrderNotFound({ businessReference }: { businessReference: string }) {
  const t = useTranslations('Orders.notFound')

  useBreadcrumbName(businessReference)

  return (
    <NotFoundMessage description={t('description', { businessReference })} title={t('title')}>
      <Link href={sidebarItem('orders').href} className={buttonVariants({ variant: 'outline' })}>
        {t('back')}
      </Link>
    </NotFoundMessage>
  )
}

function OrderView({ businessReference }: { businessReference: string }) {
  const t = useTranslations('Orders')
  const title = t('title', { businessReference })

  const { data, isError, isFetching, refetch } = useQuery(
    orderLifecycleDetailQuery(businessReference),
  )

  if (data?.length === 0) {
    return <OrderNotFound businessReference={businessReference} />
  }

  if (data) {
    return (
      <AppPage busy={isFetching} name={businessReference} title={title}>
        {data.length > 1 && (
          <p className="text-muted-foreground text-sm">
            {t('tradingPartnerCount', { count: data.length })}
          </p>
        )}
        {data.map((lifecycle) => (
          <OrderTimeline key={lifecycle.tradingPartner.id} lifecycle={lifecycle} />
        ))}
      </AppPage>
    )
  }

  return (
    <AppPage name={businessReference} title={title}>
      {isError ? (
        <LoadError
          description={t('error.description', { businessReference })}
          retryLabel={t('error.retry')}
          title={t('error.title')}
          onRetry={() => void refetch()}
        />
      ) : (
        <Loading label={t('loading', { businessReference })} rowClassName="h-24" rows={3} />
      )}
    </AppPage>
  )
}

export function OrderScreen({ businessReference }: { businessReference: string }) {
  const parsed = businessReferenceSchema.safeParse(businessReference)

  return parsed.success ? (
    <OrderView businessReference={parsed.data} />
  ) : (
    <OrderNotFound businessReference={businessReference} />
  )
}
