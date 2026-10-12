import { OrderLifecycleScreen } from '@/components/order-lifecycle/order-lifecycle-screen'
import { pageMetadata } from '@/components/page-metadata'
import { firstSearchParam } from '@/lib/search-params'

export const generateMetadata = pageMetadata('orders')

export default async function Page({ searchParams }: PageProps<'/order-lifecycle'>) {
  const { businessReference } = await searchParams

  return <OrderLifecycleScreen businessReference={firstSearchParam(businessReference)} />
}
