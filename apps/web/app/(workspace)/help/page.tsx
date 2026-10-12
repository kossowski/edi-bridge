import { HelpScreen } from '@/components/help/help-screen'
import { pageMetadata } from '@/components/page-metadata'

export const generateMetadata = pageMetadata('help')

export default function Page() {
  return <HelpScreen />
}
