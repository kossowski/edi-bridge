import { PagePlaceholder, placeholderMetadata } from '@/components/page-placeholder'
import { OperatorOnly } from '@/components/session/operator-only'

export const generateMetadata = placeholderMetadata('operator')

export default function Page() {
  return (
    <OperatorOnly>
      <PagePlaceholder page="operator" />
    </OperatorOnly>
  )
}
