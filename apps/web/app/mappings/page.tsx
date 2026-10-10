import { MappingsScreen } from '@/components/mappings/mappings-screen'
import { placeholderMetadata } from '@/components/page-placeholder'

export const generateMetadata = placeholderMetadata('mappings')

export default function Page() {
  return <MappingsScreen />
}
