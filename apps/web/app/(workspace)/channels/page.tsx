import { ChannelsScreen } from '@/components/channels/channels-screen'
import { pageMetadata } from '@/components/page-metadata'

export const generateMetadata = pageMetadata('allConnections')

export default function Page() {
  return <ChannelsScreen />
}
