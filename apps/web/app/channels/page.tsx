import { ChannelsScreen } from '@/components/channels/channels-screen'
import { placeholderMetadata } from '@/components/page-placeholder'

export const generateMetadata = placeholderMetadata('channels')

export default function Page() {
  return <ChannelsScreen />
}
