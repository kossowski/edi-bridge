import { DocumentStructuresScreen } from '@/components/document-structures/document-structures-screen'
import { pageMetadata } from '@/components/page-metadata'

export const generateMetadata = pageMetadata('dataFormats')

export default function Page() {
  return <DocumentStructuresScreen />
}
