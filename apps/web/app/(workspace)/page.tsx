import { HomeScreen } from '@/components/home/home-screen'
import { pageMetadata } from '@/components/page-metadata'

export const generateMetadata = pageMetadata('home')

export default function Page() {
  return <HomeScreen />
}
