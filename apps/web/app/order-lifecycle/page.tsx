import { OrderLifecycleScreen } from '@/components/order-lifecycle/order-lifecycle-screen'
import { placeholderMetadata } from '@/components/page-placeholder'

export const generateMetadata = placeholderMetadata('orderLifecycle')

export default async function Page({ searchParams }: PageProps<'/order-lifecycle'>) {
  const { businessReference } = await searchParams

  return (
    <OrderLifecycleScreen
      businessReference={
        Array.isArray(businessReference) ? businessReference[0] : businessReference
      }
    />
  )
}
