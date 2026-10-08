import { PagePlaceholder, placeholderMetadata } from '@/components/page-placeholder'

export const generateMetadata = placeholderMetadata('mappings')

export default function Page() {
  return <PagePlaceholder page="mappings" />
}
