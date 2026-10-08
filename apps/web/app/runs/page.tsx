import { PagePlaceholder, placeholderMetadata } from '@/components/page-placeholder'

export const generateMetadata = placeholderMetadata('runs')

export default function Page() {
  return <PagePlaceholder page="runs" />
}
