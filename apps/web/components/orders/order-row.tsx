'use client'

import { useTranslations } from 'next-intl'
import Link from 'next/link'

import { RelativeTime } from '@/components/documents/relative-time'
import { OrderStatusIcon, StepIcon } from '@/components/orders/order-status'
import { usePlainNames } from '@/components/plain-names'
import { orderHref } from '@/lib/navigation'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from '@edi-bridge/ui/components/item'
import { Skeleton } from '@edi-bridge/ui/components/skeleton'

import type { OrderLifecycleSummary } from '@edi-bridge/contracts'

function MiniProgress({ steps }: { steps: OrderLifecycleSummary['steps'] }) {
  const t = useTranslations('Orders')
  const plainNames = usePlainNames()

  return (
    <ol aria-label={t('list.row.progress')} className="flex items-center">
      {steps.map((step, index) => {
        const label = t('list.row.step', {
          document: plainNames.messageTypeName(step.messageType),
          state: t(`timeline.state.${step.state}`),
        })

        return (
          <li key={step.messageType} title={label} className="flex items-center">
            {index > 0 && (
              <span
                aria-hidden
                className="bg-border data-[done=true]:bg-success-text/50 h-px w-3 @md:w-5"
                data-done={steps[index - 1]?.state === 'done'}
              />
            )}
            <StepIcon size="sm" state={step.state} />
            <span className="sr-only">{label}</span>
          </li>
        )
      })}
    </ol>
  )
}

export function OrderRow({ order }: { order: OrderLifecycleSummary }) {
  const t = useTranslations('Orders')

  return (
    <Item render={<li />} variant="outline" className="items-start">
      <ItemContent className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <ItemTitle className="line-clamp-none">
            <Link
              href={orderHref(order.businessReference)}
              className="focus-visible:ring-ring/50 rounded-sm underline-offset-4 outline-none hover:underline focus-visible:underline focus-visible:ring-3">
              {t('title', { businessReference: order.businessReference })}
            </Link>
          </ItemTitle>
          <span className="flex items-center gap-1.5 text-sm font-medium">
            <OrderStatusIcon status={order.status} className="size-4" />
            {t(`status.${order.status}`)}
          </span>
        </div>
        <ItemDescription className="line-clamp-none">
          {t.rich('list.row.tradingPartnerAndActivity', {
            tradingPartner: order.tradingPartner.name,
            time: () => <RelativeTime dateTime={order.lastActivityAt} />,
          })}
        </ItemDescription>
      </ItemContent>
      <ItemActions className="basis-full @xl:basis-auto @xl:justify-end">
        <MiniProgress steps={order.steps} />
      </ItemActions>
    </Item>
  )
}

export function OrderRowSkeleton() {
  return (
    <Item render={<li />} variant="outline" className="items-start">
      <ItemContent>
        <Skeleton className="h-4 w-56 max-w-full" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </ItemContent>
      <Skeleton className="h-6 w-28" />
    </Item>
  )
}
