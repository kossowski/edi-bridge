import { DocumentsScreen } from '@/components/documents/documents-screen'
import { pageMetadata } from '@/components/page-metadata'

export const generateMetadata = pageMetadata('documents')

export default function Page() {
  return <DocumentsScreen />
}
