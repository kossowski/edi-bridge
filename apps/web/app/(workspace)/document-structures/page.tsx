import { DocumentStructuresScreen } from '@/components/document-structures/document-structures-screen'
import { placeholderMetadata } from '@/components/page-placeholder'

export const generateMetadata = placeholderMetadata('documentStructures')

export default function Page() {
  return <DocumentStructuresScreen />
}
