import { MappingsScreen } from '@/components/mappings/mappings-screen'
import { pageMetadata } from '@/components/page-metadata'
import { newMappingMessageTypeIn } from '@/lib/navigation'

export const generateMetadata = pageMetadata('mappings')

export default async function Page({ searchParams }: PageProps<'/mappings'>) {
  return <MappingsScreen newMessageType={newMappingMessageTypeIn(await searchParams)} />
}
