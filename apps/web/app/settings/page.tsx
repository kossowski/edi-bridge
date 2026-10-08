import { PagePlaceholder, placeholderMetadata } from '@/components/page-placeholder'

export const generateMetadata = placeholderMetadata('settings')

export default function Page() {
  return <PagePlaceholder page="settings" />
}
