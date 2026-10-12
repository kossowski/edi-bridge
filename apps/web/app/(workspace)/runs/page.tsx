import { pageMetadata } from '@/components/page-metadata'
import { RunsScreen } from '@/components/runs/runs-screen'

export const generateMetadata = pageMetadata('documents')

export default function Page() {
  return <RunsScreen />
}
