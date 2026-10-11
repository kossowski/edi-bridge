import { MappingsScreen } from '@/components/mappings/mappings-screen'
import { pageMetadata } from '@/components/page-metadata'

export const generateMetadata = pageMetadata('mappings')

export default function Page() {
  return <MappingsScreen />
}
