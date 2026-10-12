import { getTranslations } from 'next-intl/server'

import type { Metadata } from 'next'

import { OrderScreen } from '@/components/orders/order-screen'

function decoded(segment: string) {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

export async function generateMetadata({
  params,
}: PageProps<'/orders/[business-reference]'>): Promise<Metadata> {
  const { 'business-reference': businessReference } = await params
  const t = await getTranslations()

  return {
    title: {
      absolute: `${t('Orders.title', { businessReference: decoded(businessReference) })} · ${t('Shell.appName')}`,
    },
  }
}

export default async function Page({ params }: PageProps<'/orders/[business-reference]'>) {
  const { 'business-reference': businessReference } = await params

  return <OrderScreen businessReference={decoded(businessReference)} />
}
