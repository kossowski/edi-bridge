import { OrdersScreen } from '@/components/orders/orders-screen'
import { pageMetadata } from '@/components/page-metadata'

export const generateMetadata = pageMetadata('orders')

export default function Page() {
  return <OrdersScreen />
}
