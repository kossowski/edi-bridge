import { WorkspacesScreen } from '@/components/operator/workspaces-screen'
import { pageMetadata } from '@/components/page-metadata'
import { OperatorOnly } from '@/components/session/operator-only'

export const generateMetadata = pageMetadata('operatorArea')

export default function Page() {
  return (
    <OperatorOnly>
      <WorkspacesScreen />
    </OperatorOnly>
  )
}
