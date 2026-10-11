import { OverviewScreen } from '@/components/overview/overview-screen'
import { pageMetadata } from '@/components/page-metadata'

export const generateMetadata = pageMetadata('home')

export default function Page() {
  return <OverviewScreen />
}
