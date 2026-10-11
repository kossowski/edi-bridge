import { placeholderMetadata } from '@/components/page-placeholder'
import { SettingsScreen } from '@/components/settings/settings-screen'

export const generateMetadata = placeholderMetadata('settings')

export default function Page() {
  return <SettingsScreen />
}
