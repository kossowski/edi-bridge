import { WorkspacesScreen } from '@/components/operator/workspaces-screen'
import { placeholderMetadata } from '@/components/page-placeholder'
import { OperatorOnly } from '@/components/session/operator-only'

export const generateMetadata = placeholderMetadata('operator')

export default function Page() {
  return (
    <OperatorOnly>
      <WorkspacesScreen />
    </OperatorOnly>
  )
}
