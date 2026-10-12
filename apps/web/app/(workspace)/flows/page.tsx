import { FlowsScreen } from '@/components/flows/flows-screen'
import { pageMetadata } from '@/components/page-metadata'

export const generateMetadata = pageMetadata('allDocumentRoutes')

export default function Page() {
  return <FlowsScreen />
}
