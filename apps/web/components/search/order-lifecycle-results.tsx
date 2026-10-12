import { useTranslations } from 'next-intl'

import { CommandItemHint } from '@/components/search/command-item-hint'
import { navigationItems } from '@/lib/navigation'
import { type OrderLifecycle } from '@edi-bridge/contracts'
import { CommandGroup, CommandItem } from '@edi-bridge/ui/components/command'

export function orderLifecycleResultValue(orderLifecycle: OrderLifecycle) {
  return `order-lifecycle ${orderLifecycle.businessReference} ${orderLifecycle.tradingPartner.id}`
}

export function OrderLifecycleResults({
  businessReference,
  orderLifecycles,
  onOpen,
}: {
  businessReference: string
  orderLifecycles: ReadonlyArray<OrderLifecycle>
  onOpen: (href: string) => void
}) {
  const t = useTranslations('Search')

  if (orderLifecycles.length === 0) {
    return null
  }

  return (
    <CommandGroup heading={t('groups.orders')}>
      {orderLifecycles.map((orderLifecycle) => (
        <CommandItem
          key={orderLifecycle.tradingPartner.id}
          keywords={[businessReference, orderLifecycle.businessReference]}
          value={orderLifecycleResultValue(orderLifecycle)}
          onSelect={() =>
            onOpen(
              `${navigationItems.orderLifecycle.href}?${new URLSearchParams({ businessReference: orderLifecycle.businessReference })}`,
            )
          }>
          <span className="truncate">
            {t('order', { businessReference: orderLifecycle.businessReference })}
          </span>
          <CommandItemHint className="min-w-0 shrink truncate">
            {orderLifecycle.tradingPartner.name}
          </CommandItemHint>
        </CommandItem>
      ))}
    </CommandGroup>
  )
}
