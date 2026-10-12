import { LookupTablesScreen } from '@/components/lookup-tables/lookup-tables-screen'
import { pageMetadata } from '@/components/page-metadata'

export const generateMetadata = pageMetadata('codeTranslations')

export default function Page() {
  return <LookupTablesScreen />
}
