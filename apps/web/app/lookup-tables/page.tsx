import { LookupTablesScreen } from '@/components/lookup-tables/lookup-tables-screen'
import { placeholderMetadata } from '@/components/page-placeholder'

export const generateMetadata = placeholderMetadata('lookupTables')

export default function Page() {
  return <LookupTablesScreen />
}
