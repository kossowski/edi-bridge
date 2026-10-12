'use client'

import { useTranslations } from 'next-intl'
import { Suspense } from 'react'

import { AppPage } from '@/components/app-page'
import { OrdersList } from '@/components/orders/orders-list'

export function OrdersScreen() {
  const t = useTranslations('Sidebar.items')

  return (
    <AppPage title={t('orders.label')} className="gap-4">
      <Suspense>
        <OrdersList />
      </Suspense>
    </AppPage>
  )
}
