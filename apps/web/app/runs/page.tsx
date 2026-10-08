import { placeholderMetadata } from '@/components/page-placeholder'
import { RunsScreen } from '@/components/runs/runs-screen'

export const generateMetadata = placeholderMetadata('runs')

export default function Page() {
  return <RunsScreen />
}
