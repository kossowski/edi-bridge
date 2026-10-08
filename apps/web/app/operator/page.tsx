import { PagePlaceholder, placeholderMetadata } from '@/components/page-placeholder'

export const generateMetadata = placeholderMetadata('operator')

export default function Page() {
  return <PagePlaceholder page="operator" />
}
