import { OverviewScreen } from '@/components/overview/overview-screen'
import { placeholderMetadata } from '@/components/page-placeholder'

export const generateMetadata = placeholderMetadata('overview')

export default function Page() {
  return <OverviewScreen />
}
